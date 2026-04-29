use std::collections::HashMap;
use std::sync::Arc;
use chrono::Utc;
use tokio::sync::RwLock;

use super::types::{
    PollerRuntimeState, PollerStrategyRuntime, PollerTargetRuntimeStat, ProviderRuntimeEvent,
    ProviderRuntimeState, ProviderRuntimeStatus,
};
const DEFAULT_FAILURE_THRESHOLD: u32 = 3;
const DEFAULT_COOLDOWN_SECS: u64 = 30;
const DEFAULT_PROBE_INTERVAL_SECS: u64 = 20;
const MAX_TIMELINE_EVENTS: usize = 20;

#[derive(Clone, Default)]
pub struct ProviderRuntimeStore {
    inner: Arc<RwLock<HashMap<String, ProviderRuntimeState>>>,
}

impl ProviderRuntimeStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn observe_provider(
        &self,
        provider_id: &str,
        provider_label: &str,
        budget_tokens: u64,
    ) {
        let mut state = self.inner.write().await;
        let entry = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderRuntimeState {
                provider_id: provider_id.to_string(),
                provider_label: provider_label.to_string(),
                budget_tokens,
                remaining_tokens: budget_tokens,
                used_tokens: 0,
                status: ProviderRuntimeStatus::Unknown,
                failure_threshold: DEFAULT_FAILURE_THRESHOLD,
                cooldown_seconds: DEFAULT_COOLDOWN_SECS,
                probe_interval_seconds: DEFAULT_PROBE_INTERVAL_SECS,
                ..ProviderRuntimeState::default()
            });
        entry.provider_label = provider_label.to_string();
        entry.budget_tokens = budget_tokens;
        if budget_tokens > 0 {
            entry.remaining_tokens = entry.remaining_tokens.min(budget_tokens);
        }
    }

    pub async fn apply_policy(
        &self,
        provider_id: &str,
        provider_label: &str,
        budget_tokens: u64,
        failure_threshold: u32,
        cooldown_seconds: u64,
        probe_interval_seconds: u64,
    ) {
        let mut state = self.inner.write().await;
        let entry = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderRuntimeState {
                provider_id: provider_id.to_string(),
                provider_label: provider_label.to_string(),
                budget_tokens,
                remaining_tokens: budget_tokens,
                used_tokens: 0,
                status: ProviderRuntimeStatus::Unknown,
                failure_threshold: failure_threshold.max(1),
                cooldown_seconds: cooldown_seconds.max(1),
                probe_interval_seconds: probe_interval_seconds.max(5),
                ..ProviderRuntimeState::default()
            });
        entry.provider_label = provider_label.to_string();
        entry.budget_tokens = budget_tokens;
        if budget_tokens > 0 {
            entry.remaining_tokens = entry.remaining_tokens.min(budget_tokens);
        }
        entry.failure_threshold = failure_threshold.max(1);
        entry.cooldown_seconds = cooldown_seconds.max(1);
        entry.probe_interval_seconds = probe_interval_seconds.max(5);
    }

    pub async fn record_request_result(
        &self,
        provider_id: &str,
        provider_label: &str,
        budget_tokens: u64,
        used_tokens: u64,
        success: bool,
        error: Option<String>,
    ) {
        let mut state = self.inner.write().await;
        let remaining_tokens = if budget_tokens == 0 {
            0
        } else {
            budget_tokens.saturating_sub(used_tokens)
        };
        let entry = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderRuntimeState {
                provider_id: provider_id.to_string(),
                provider_label: provider_label.to_string(),
                budget_tokens,
                remaining_tokens,
                used_tokens,
                status: ProviderRuntimeStatus::Unknown,
                failure_threshold: DEFAULT_FAILURE_THRESHOLD,
                cooldown_seconds: DEFAULT_COOLDOWN_SECS,
                probe_interval_seconds: DEFAULT_PROBE_INTERVAL_SECS,
                ..ProviderRuntimeState::default()
            });

        let now = Utc::now();
        let now_iso = now.to_rfc3339();
        entry.provider_label = provider_label.to_string();
        entry.budget_tokens = budget_tokens;
        entry.used_tokens = used_tokens;
        entry.remaining_tokens = remaining_tokens;
        entry.last_request_at = Some(now_iso.clone());

        if success {
            let was_half_open = matches!(entry.status, ProviderRuntimeStatus::HalfOpen);
            entry.consecutive_failures = 0;
            entry.last_success_at = Some(now_iso);
            entry.last_error = None;
            entry.circuit_open_until = None;
            entry.half_open_since = None;
            entry.status = ProviderRuntimeStatus::Healthy;
            if was_half_open {
                entry.recovery_attempts = entry.recovery_attempts.saturating_add(1);
            }
            push_timeline(
                entry,
                "recovered",
                format!("请求成功，{} 已恢复健康", entry.provider_label),
            );
            return;
        }

        entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
        entry.last_failure_at = Some(now_iso.clone());
        entry.last_error = error;
        if entry.consecutive_failures >= entry.failure_threshold.max(1) {
            entry.status = ProviderRuntimeStatus::CircuitOpen;
            entry.circuit_open_count = entry.circuit_open_count.saturating_add(1);
            entry.circuit_open_until = Some(
                (now + chrono::Duration::seconds(entry.cooldown_seconds.max(1) as i64)).to_rfc3339(),
            );
            push_timeline(
                entry,
                "circuit_opened",
                format!("连续失败达到阈值，{} 进入熔断", entry.provider_label),
            );
        } else {
            entry.status = ProviderRuntimeStatus::Degraded;
            push_timeline(
                entry,
                "request_failed",
                format!("请求失败，当前连续失败 {}", entry.consecutive_failures),
            );
        }
    }

    pub async fn record_probe_result(
        &self,
        provider_id: &str,
        provider_label: &str,
        budget_tokens: u64,
        used_tokens: u64,
        reachable: bool,
        error: Option<String>,
    ) {
        let mut state = self.inner.write().await;
        let remaining_tokens = if budget_tokens == 0 {
            0
        } else {
            budget_tokens.saturating_sub(used_tokens)
        };
        let entry = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderRuntimeState {
                provider_id: provider_id.to_string(),
                provider_label: provider_label.to_string(),
                budget_tokens,
                remaining_tokens,
                used_tokens,
                status: ProviderRuntimeStatus::Unknown,
                failure_threshold: DEFAULT_FAILURE_THRESHOLD,
                cooldown_seconds: DEFAULT_COOLDOWN_SECS,
                probe_interval_seconds: DEFAULT_PROBE_INTERVAL_SECS,
                ..ProviderRuntimeState::default()
            });

        let now_iso = Utc::now().to_rfc3339();
        entry.provider_label = provider_label.to_string();
        entry.budget_tokens = budget_tokens;
        entry.used_tokens = used_tokens;
        entry.remaining_tokens = remaining_tokens;
        entry.last_probe_at = Some(now_iso.clone());

        if reachable {
            let was_circuit_open = matches!(entry.status, ProviderRuntimeStatus::CircuitOpen);
            let was_half_open = matches!(entry.status, ProviderRuntimeStatus::HalfOpen);
            entry.last_success_at = Some(now_iso.clone());
            entry.last_error = None;
            entry.consecutive_failures = 0;
            if was_circuit_open {
                entry.status = ProviderRuntimeStatus::HalfOpen;
                entry.half_open_since = Some(now_iso);
                entry.recovery_attempts = entry.recovery_attempts.saturating_add(1);
                push_timeline(
                    entry,
                    "half_opened",
                    format!("探测成功，{} 进入半开恢复试探", entry.provider_label),
                );
            } else {
                entry.circuit_open_until = None;
                entry.half_open_since = None;
                if was_half_open {
                    entry.recovery_attempts = entry.recovery_attempts.saturating_add(1);
                    push_timeline(
                        entry,
                        "recovered",
                        format!("探测成功，{} 恢复健康", entry.provider_label),
                    );
                }
                entry.status = ProviderRuntimeStatus::Healthy;
            }
        } else {
            if matches!(entry.status, ProviderRuntimeStatus::HalfOpen) {
                entry.status = ProviderRuntimeStatus::CircuitOpen;
                entry.circuit_open_count = entry.circuit_open_count.saturating_add(1);
                entry.circuit_open_until = Some(
                    (Utc::now() + chrono::Duration::seconds(entry.cooldown_seconds.max(1) as i64)).to_rfc3339(),
                );
                entry.half_open_since = None;
                push_timeline(
                    entry,
                    "probe_failed",
                    format!("半开试探失败，{} 重新进入熔断", entry.provider_label),
                );
            } else if entry.status != ProviderRuntimeStatus::CircuitOpen {
                entry.status = ProviderRuntimeStatus::Degraded;
                push_timeline(
                    entry,
                    "probe_failed",
                    format!("健康探测失败，{} 标记为降级", entry.provider_label),
                );
            }
            if error.is_some() {
                entry.last_error = error;
            }
        }
    }

    pub async fn try_enter_half_open(&self, provider_id: &str) -> Option<ProviderRuntimeState> {
        let mut state = self.inner.write().await;
        let entry = state.get_mut(provider_id)?;
        if entry.status != ProviderRuntimeStatus::CircuitOpen {
            return Some(entry.clone());
        }
        let now = Utc::now();
        let can_probe = entry
            .circuit_open_until
            .as_deref()
            .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
            .map(|time| time.with_timezone(&Utc) <= now)
            .unwrap_or(true);
        if !can_probe {
            return Some(entry.clone());
        }

        entry.status = ProviderRuntimeStatus::HalfOpen;
        entry.half_open_since = Some(now.to_rfc3339());
        entry.circuit_open_until = None;
        entry.recovery_attempts = entry.recovery_attempts.saturating_add(1);
        push_timeline(
            entry,
            "half_opened",
            format!("冷却结束，{} 进入半开恢复试探", entry.provider_label),
        );
        Some(entry.clone())
    }

    #[cfg(test)]
    pub async fn expire_circuit_open_for_test(&self, provider_id: &str) {
        if let Some(entry) = self.inner.write().await.get_mut(provider_id) {
            entry.circuit_open_until = Some((Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
        }
    }

    pub async fn snapshot(&self) -> Vec<ProviderRuntimeState> {
        let mut items: Vec<_> = self.inner.read().await.values().cloned().collect();
        items.sort_by(|a, b| a.provider_label.cmp(&b.provider_label).then_with(|| a.provider_id.cmp(&b.provider_id)));
        items
    }

    pub async fn get(&self, provider_id: &str) -> Option<ProviderRuntimeState> {
        self.inner.read().await.get(provider_id).cloned()
    }

    pub async fn retain_only(&self, active_provider_ids: &[String]) {
        let active: std::collections::HashSet<&str> = active_provider_ids.iter().map(String::as_str).collect();
        self.inner
            .write()
            .await
            .retain(|provider_id, _| active.contains(provider_id.as_str()));
    }
}

#[derive(Clone, Default)]
pub struct PollerRuntimeStore {
    inner: Arc<RwLock<HashMap<String, PollerRuntimeState>>>,
}

impl PollerRuntimeStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn record_selection(
        &self,
        poller_id: &str,
        poller_label: &str,
        strategy: PollerStrategyRuntime,
        cursor: usize,
        failure_threshold: u32,
        cooldown_seconds: u64,
        probe_interval_seconds: u64,
        cycle_requests: u32,
        served_in_current_slot: u32,
        current_slot_target_id: &str,
        target_configs: &[(String, String, u32)],
        selected_target: &str,
        selected_target_label: &str,
        selected_target_weight: u32,
        selected_provider_id: &str,
        selected_provider_label: &str,
    ) {
        let mut state = self.inner.write().await;
        let entry = state
            .entry(poller_id.to_string())
            .or_insert_with(|| PollerRuntimeState {
                poller_id: poller_id.to_string(),
                poller_label: poller_label.to_string(),
                strategy,
                failure_threshold: failure_threshold.max(1),
                cooldown_seconds: cooldown_seconds.max(1),
                probe_interval_seconds: probe_interval_seconds.max(5),
                cycle_requests,
                ..PollerRuntimeState::default()
            });

        entry.poller_label = poller_label.to_string();
        entry.strategy = strategy;
        entry.cursor = cursor;
        entry.failure_threshold = failure_threshold.max(1);
        entry.cooldown_seconds = cooldown_seconds.max(1);
        entry.probe_interval_seconds = probe_interval_seconds.max(5);
        entry.cycle_requests = cycle_requests;
        entry.served_in_current_slot = served_in_current_slot;
        entry.current_slot_target_id = Some(current_slot_target_id.to_string());
        entry.total_selections = entry.total_selections.saturating_add(1);
        entry.last_selected_target = Some(selected_target.to_string());
        entry.last_selected_provider_id = Some(selected_provider_id.to_string());
        entry.last_selected_provider_label = Some(selected_provider_label.to_string());
        entry.last_selected_at = Some(Utc::now().to_rfc3339());
        for (target_id, target_label, configured_weight) in target_configs {
            if let Some(target_stat) = entry
                .target_stats
                .iter_mut()
                .find(|item| item.target_id == *target_id)
            {
                target_stat.target_label = target_label.clone();
                target_stat.configured_weight = configured_weight.max(&1).to_owned();
            } else {
                entry.target_stats.push(PollerTargetRuntimeStat {
                    target_id: target_id.clone(),
                    target_label: target_label.clone(),
                    configured_weight: (*configured_weight).max(1),
                    hits: 0,
                    last_selected_at: None,
                    last_selected_provider_label: None,
                });
            }
        }
        let hit_at = entry.last_selected_at.clone();
        if let Some(target_stat) = entry
            .target_stats
            .iter_mut()
            .find(|item| item.target_id == selected_target)
        {
            target_stat.target_label = selected_target_label.to_string();
            target_stat.configured_weight = selected_target_weight.max(1);
            target_stat.hits = target_stat.hits.saturating_add(1);
            target_stat.last_selected_at = hit_at;
            target_stat.last_selected_provider_label = Some(selected_provider_label.to_string());
        } else {
            entry.target_stats.push(PollerTargetRuntimeStat {
                target_id: selected_target.to_string(),
                target_label: selected_target_label.to_string(),
                configured_weight: selected_target_weight.max(1),
                hits: 1,
                last_selected_at: hit_at,
                last_selected_provider_label: Some(selected_provider_label.to_string()),
            });
        }
        entry.target_stats.sort_by(|a, b| b.hits.cmp(&a.hits).then_with(|| a.target_id.cmp(&b.target_id)));
    }

    pub async fn snapshot(&self) -> Vec<PollerRuntimeState> {
        let mut items: Vec<_> = self.inner.read().await.values().cloned().collect();
        items.sort_by(|a, b| a.poller_label.cmp(&b.poller_label).then_with(|| a.poller_id.cmp(&b.poller_id)));
        items
    }
}

pub fn circuit_open(now: chrono::DateTime<Utc>, until: &Option<String>) -> bool {
    until
        .as_deref()
        .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
        .map(|time| time.with_timezone(&Utc) > now)
        .unwrap_or(false)
}

pub fn probe_interval() -> std::time::Duration {
    std::time::Duration::from_secs(5)
}

fn push_timeline(entry: &mut ProviderRuntimeState, kind: &str, detail: String) {
    entry.timeline.push(ProviderRuntimeEvent {
        at: Utc::now().to_rfc3339(),
        kind: kind.to_string(),
        detail,
    });
    if entry.timeline.len() > MAX_TIMELINE_EVENTS {
        let drop_count = entry.timeline.len() - MAX_TIMELINE_EVENTS;
        entry.timeline.drain(0..drop_count);
    }
}
