use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::RwLock;

use super::types::{
    ProxyMetricsEntitySummary, ProxyMetricsPairSummary, ProxyMetricsSnapshot,
    ProxyMetricsSummary, ProxyRequestMetric,
};

const MAX_RECENT_REQUESTS: usize = 5000;

#[derive(Default)]
struct MetricsState {
    summary: ProxyMetricsSummary,
    applications: HashMap<String, ProxyMetricsEntitySummary>,
    providers: HashMap<String, ProxyMetricsEntitySummary>,
    app_provider_pairs: HashMap<String, ProxyMetricsPairSummary>,
    recent_requests: VecDeque<ProxyRequestMetric>,
}

#[derive(Clone, Default)]
pub struct MetricsStore {
    inner: Arc<RwLock<MetricsState>>,
    next_id: Arc<AtomicU64>,
}

impl MetricsStore {
    pub fn new() -> Self {
        Self::default()
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
