use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::types::{
    ProxyMetricsEntitySummary, ProxyMetricsPairSummary, ProxyMetricsSnapshot,
    ProxyMetricsSummary, ProxyRequestMetric,
};

const MAX_RECENT_REQUESTS: usize = 5000;
const APP_DIR: &str = ".aastation";
const METRICS_FILE: &str = "metrics.json";
const TMP_SUFFIX: &str = ".tmp";

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

        // Keep monitoring records across app restarts.
        let persisted = PersistedMetrics {
            next_id: self.next_id.load(Ordering::Relaxed),
            state: state.clone(),
        };
        if let Err(err) = save_persisted_metrics(&persisted) {
            tracing::warn!("Failed to persist proxy metrics: {}", err);
        }
    }

    pub async fn snapshot(&self) -> ProxyMetricsSnapshot {
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

        ProxyMetricsSnapshot {
            generated_at: Utc::now().to_rfc3339(),
            summary: state.summary.clone(),
            applications,
            providers,
            app_provider_pairs,
            recent_requests: state.recent_requests.iter().cloned().collect(),
        }
    }
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
