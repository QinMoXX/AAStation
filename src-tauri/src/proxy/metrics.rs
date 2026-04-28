use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::types::{
    PollerRuntimeState, ProviderRuntimeState, ProviderRuntimeStatus, ProxyMetricsEntitySummary,
    ProxyMetricsPairSummary, ProxyMetricsSnapshot, ProxyMetricsSummary, ProxyRequestMetric,
};

const MAX_RECENT_REQUESTS: usize = 5000;
const APP_DIR: &str = ".aastation";
const METRICS_FILE: &str = "metrics.json";
const TMP_SUFFIX: &str = ".tmp";
/// Minimum seconds between successive disk persists. Hot-path requests are
/// accumulated in memory and flushed at most once every this many seconds,
/// keeping disk I/O well away from the async request-handling threads.
const PERSIST_INTERVAL_SECS: u64 = 5;

#[derive(Clone, Default, Serialize, Deserialize)]
struct MetricsState {
    summary: ProxyMetricsSummary,
    applications: HashMap<String, ProxyMetricsEntitySummary>,
    providers: HashMap<String, ProxyMetricsEntitySummary>,
    app_provider_pairs: HashMap<String, ProxyMetricsPairSummary>,
    recent_requests: VecDeque<ProxyRequestMetric>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct PersistedMetrics {
    #[serde(default)]
    next_id: u64,
    #[serde(default)]
    state: MetricsState,
}

#[derive(Clone, Default)]
pub struct MetricsStore {
    inner: Arc<RwLock<MetricsState>>,
    next_id: Arc<AtomicU64>,
    /// Unix-second timestamp of the last successful persist attempt.
    /// Used to rate-limit disk writes without blocking the hot path.
    last_persist_secs: Arc<AtomicU64>,
}

impl MetricsStore {
    pub fn new() -> Self {
        let persisted = load_persisted_metrics().unwrap_or_default();
        let mut state = persisted.state;
        while state.recent_requests.len() > MAX_RECENT_REQUESTS {
            state.recent_requests.pop_back();
        }
        let restored_next_id = persisted.next_id.max(state.summary.requests);

        Self {
            inner: Arc::new(RwLock::new(state)),
            next_id: Arc::new(AtomicU64::new(restored_next_id)),
            last_persist_secs: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn record(&self, mut request: ProxyRequestMetric) {
        if request.id.is_empty() {
            let seq = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
            request.id = format!("req-{seq}");
        }

        let mut state = self.inner.write().await;
        accumulate_summary(&mut state.summary, &request);

        let app_entry = state
            .applications
            .entry(request.app_id.clone())
            .or_insert_with(|| ProxyMetricsEntitySummary {
                id: request.app_id.clone(),
                label: request.app_label.clone(),
                summary: ProxyMetricsSummary::default(),
            });
        app_entry.label = request.app_label.clone();
        accumulate_summary(&mut app_entry.summary, &request);

        let provider_entry = state
            .providers
            .entry(request.provider_id.clone())
            .or_insert_with(|| ProxyMetricsEntitySummary {
                id: request.provider_id.clone(),
                label: request.provider_label.clone(),
                summary: ProxyMetricsSummary::default(),
            });
        provider_entry.label = request.provider_label.clone();
        accumulate_summary(&mut provider_entry.summary, &request);

        let pair_key = format!("{}::{}", request.app_id, request.provider_id);
        let pair_entry = state
            .app_provider_pairs
            .entry(pair_key)
            .or_insert_with(|| ProxyMetricsPairSummary {
                app_id: request.app_id.clone(),
                app_label: request.app_label.clone(),
                provider_id: request.provider_id.clone(),
                provider_label: request.provider_label.clone(),
                summary: ProxyMetricsSummary::default(),
            });
        pair_entry.app_label = request.app_label.clone();
        pair_entry.provider_label = request.provider_label.clone();
        accumulate_summary(&mut pair_entry.summary, &request);

        state.recent_requests.push_front(request);
        while state.recent_requests.len() > MAX_RECENT_REQUESTS {
            state.recent_requests.pop_back();
        }

        // Rate-limit disk persistence: only write at most once per
        // PERSIST_INTERVAL_SECS seconds. This keeps file I/O off the hot
        // path while still ensuring metrics are flushed regularly.
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let last = self.last_persist_secs.load(Ordering::Relaxed);
        if now_secs.saturating_sub(last) >= PERSIST_INTERVAL_SECS {
            // Snapshot the data needed for serialisation while we still hold
            // the write lock, then release it before the blocking I/O call.
            let persisted = PersistedMetrics {
                next_id: self.next_id.load(Ordering::Relaxed),
                state: state.clone(),
            };
            drop(state); // release write lock before blocking I/O

            self.last_persist_secs.store(now_secs, Ordering::Relaxed);

            // Offload the synchronous fs::write / fs::rename to a dedicated
            // blocking thread so the Tokio async worker is never stalled.
            if let Err(err) = tokio::task::spawn_blocking(move || save_persisted_metrics(&persisted))
                .await
                .unwrap_or_else(|e| Err(format!("persist task panicked: {e}")))
            {
                tracing::warn!("Failed to persist proxy metrics: {}", err);
            }
        }
    }

    pub async fn snapshot(
        &self,
        mut provider_runtime: Vec<ProviderRuntimeState>,
        poller_runtime: Vec<PollerRuntimeState>,
    ) -> ProxyMetricsSnapshot {
        let state = self.inner.read().await;

        let mut applications: Vec<_> = state.applications.values().cloned().collect();
        applications.sort_by(|a, b| {
            b.summary
                .requests
                .cmp(&a.summary.requests)
                .then_with(|| a.label.cmp(&b.label))
        });

        let mut providers: Vec<_> = state.providers.values().cloned().collect();
        providers.sort_by(|a, b| {
            b.summary
                .requests
                .cmp(&a.summary.requests)
                .then_with(|| a.label.cmp(&b.label))
        });

        let mut app_provider_pairs: Vec<_> = state.app_provider_pairs.values().cloned().collect();
        app_provider_pairs.sort_by(|a, b| {
            b.summary
                .requests
                .cmp(&a.summary.requests)
                .then_with(|| a.app_label.cmp(&b.app_label))
                .then_with(|| a.provider_label.cmp(&b.provider_label))
        });

        // Backfill persisted token usage into provider_runtime entries.
        // After an app restart, ProviderRuntimeStore is in-memory and starts empty,
        // but MetricsStore carries cumulative totals from disk. This merge ensures
        // the frontend can display real usage even when the proxy hasn't been started.
        let runtime_ids: std::collections::HashSet<String> = provider_runtime
            .iter()
            .map(|r| r.provider_id.clone())
            .collect();

        for entry in &mut provider_runtime {
            if let Some(entity) = state.providers.get(&entry.provider_id) {
                let persisted_total = entity.summary.total_tokens;
                if persisted_total > entry.used_tokens {
                    entry.used_tokens = persisted_total;
                    entry.remaining_tokens = if entry.budget_tokens > 0 {
                        entry.budget_tokens.saturating_sub(persisted_total)
                    } else {
                        0
                    };
                }
            }
        }

        // Create synthetic runtime entries for providers that have persisted
        // metrics but no runtime entry yet (e.g. after app restart, before re-publish).
        for entity in state.providers.values() {
            if !runtime_ids.contains(&entity.id) {
                provider_runtime.push(ProviderRuntimeState {
                    provider_id: entity.id.clone(),
                    provider_label: entity.label.clone(),
                    status: ProviderRuntimeStatus::Unknown,
                    budget_tokens: 0,
                    used_tokens: entity.summary.total_tokens,
                    remaining_tokens: 0,
                    ..ProviderRuntimeState::default()
                });
            }
        }

        ProxyMetricsSnapshot {
            generated_at: Utc::now().to_rfc3339(),
            summary: state.summary.clone(),
            applications,
            providers,
            app_provider_pairs,
            recent_requests: state.recent_requests.iter().cloned().collect(),
            provider_runtime,
            poller_runtime,
        }
    }

    pub async fn provider_summary(
        &self,
        provider_id: &str,
    ) -> Option<ProxyMetricsEntitySummary> {
        let state = self.inner.read().await;
        state.providers.get(provider_id).cloned()
    }

    pub async fn latest_provider_request(
        &self,
        provider_id: &str,
    ) -> Option<ProxyRequestMetric> {
        let state = self.inner.read().await;
        state
            .recent_requests
            .iter()
            .find(|request| request.provider_id == provider_id)
            .cloned()
    }

    pub async fn replace_with_snapshot(
        &self,
        snapshot: ProxyMetricsSnapshot,
    ) -> Result<(), String> {
        let mut state = MetricsState {
            summary: snapshot.summary,
            applications: snapshot
                .applications
                .into_iter()
                .map(|entity| (entity.id.clone(), entity))
                .collect(),
            providers: snapshot
                .providers
                .into_iter()
                .map(|entity| (entity.id.clone(), entity))
                .collect(),
            app_provider_pairs: snapshot
                .app_provider_pairs
                .into_iter()
                .map(|pair| (format!("{}::{}", pair.app_id, pair.provider_id), pair))
                .collect(),
            recent_requests: snapshot.recent_requests.into_iter().collect(),
        };

        while state.recent_requests.len() > MAX_RECENT_REQUESTS {
            state.recent_requests.pop_back();
        }

        let next_id = state
            .recent_requests
            .iter()
            .filter_map(|request| extract_request_sequence(&request.id))
            .max()
            .unwrap_or(0)
            .max(state.summary.requests);

        let persisted = PersistedMetrics {
            next_id,
            state: state.clone(),
        };

        {
            let mut inner = self.inner.write().await;
            *inner = state;
        }
        self.next_id.store(next_id, Ordering::Relaxed);
        self.last_persist_secs.store(0, Ordering::Relaxed);

        tokio::task::spawn_blocking(move || save_persisted_metrics(&persisted))
            .await
            .unwrap_or_else(|e| Err(format!("persist task panicked: {e}")))?;

        Ok(())
    }
}

fn extract_request_sequence(request_id: &str) -> Option<u64> {
    request_id.strip_prefix("req-")?.parse::<u64>().ok()
}

fn metrics_path() -> Result<PathBuf, String> {
    let home = dirs_home_dir()?;
    Ok(home.join(APP_DIR).join(METRICS_FILE))
}

fn dirs_home_dir() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(p));
    }
    if let (Some(drive), Some(path)) = (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        let mut buf = PathBuf::from(drive);
        buf.push(path);
        return Ok(buf);
    }
    Err("Cannot determine home directory".to_string())
}

fn load_persisted_metrics() -> Result<PersistedMetrics, String> {
    let path = metrics_path()?;
    if !path.exists() {
        return Ok(PersistedMetrics::default());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<PersistedMetrics>(&content).map_err(|e| e.to_string())
}

fn save_persisted_metrics(metrics: &PersistedMetrics) -> Result<(), String> {
    let path = metrics_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp_path = path.with_extension(format!("json{}", TMP_SUFFIX));
    let content = serde_json::to_string_pretty(metrics).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn accumulate_summary(summary: &mut ProxyMetricsSummary, request: &ProxyRequestMetric) {
    summary.requests += 1;
    if request.success {
        summary.successful_requests += 1;
    } else {
        summary.failed_requests += 1;
    }
    if request.streamed {
        summary.streamed_requests += 1;
    }
    summary.input_tokens += request.input_tokens;
    summary.output_tokens += request.output_tokens;
    summary.total_tokens += request.total_tokens;
    summary.total_latency_ms += request.duration_ms;
    summary.last_request_at = Some(request.completed_at.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store_with_state(state: MetricsState) -> MetricsStore {
        MetricsStore {
            inner: Arc::new(RwLock::new(state)),
            next_id: Arc::new(AtomicU64::new(0)),
            last_persist_secs: Arc::new(AtomicU64::new(0)),
        }
    }

    #[tokio::test]
    async fn snapshot_backfills_runtime_tokens_from_persisted_provider_summary() {
        let mut state = MetricsState::default();
        state.providers.insert(
            "provider-1".to_string(),
            ProxyMetricsEntitySummary {
                id: "provider-1".to_string(),
                label: "Provider 1".to_string(),
                summary: ProxyMetricsSummary {
                    total_tokens: 120,
                    ..ProxyMetricsSummary::default()
                },
            },
        );
        let store = make_store_with_state(state);

        let snapshot = store
            .snapshot(
                vec![ProviderRuntimeState {
                    provider_id: "provider-1".to_string(),
                    provider_label: "Provider 1".to_string(),
                    budget_tokens: 200,
                    used_tokens: 30,
                    remaining_tokens: 170,
                    ..ProviderRuntimeState::default()
                }],
                vec![],
            )
            .await;

        assert_eq!(snapshot.provider_runtime.len(), 1);
        let runtime = &snapshot.provider_runtime[0];
        assert_eq!(runtime.used_tokens, 120);
        assert_eq!(runtime.remaining_tokens, 80);
    }

    #[tokio::test]
    async fn snapshot_adds_synthetic_runtime_for_persisted_provider() {
        let mut state = MetricsState::default();
        state.providers.insert(
            "provider-2".to_string(),
            ProxyMetricsEntitySummary {
                id: "provider-2".to_string(),
                label: "Provider 2".to_string(),
                summary: ProxyMetricsSummary {
                    total_tokens: 66,
                    ..ProxyMetricsSummary::default()
                },
            },
        );
        let store = make_store_with_state(state);

        let snapshot = store.snapshot(vec![], vec![]).await;
        assert_eq!(snapshot.provider_runtime.len(), 1);

        let runtime = &snapshot.provider_runtime[0];
        assert_eq!(runtime.provider_id, "provider-2");
        assert_eq!(runtime.provider_label, "Provider 2");
        assert_eq!(runtime.status, ProviderRuntimeStatus::Unknown);
        assert_eq!(runtime.used_tokens, 66);
        assert_eq!(runtime.budget_tokens, 0);
        assert_eq!(runtime.remaining_tokens, 0);
    }
}
