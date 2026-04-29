use std::collections::HashMap;
use std::sync::Arc;

use axum::http::HeaderMap;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::error::ProxyError;
use super::health::circuit_open;
use super::metrics::MetricsStore;
use super::types::{
    CompiledRoute, MatchType, PollerStrategyRuntime, RouteTable,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowPlan {
    pub entry_node_id: String,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
}

impl WorkflowPlan {
    pub fn is_empty(&self) -> bool {
        self.entry_node_id.is_empty() || self.nodes.is_empty()
    }

    fn node(&self, node_id: &str) -> Option<&WorkflowNode> {
        self.nodes.iter().find(|node| node.id == node_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    #[serde(flatten)]
    pub kind: WorkflowNodeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkflowNodeKind {
    Match(WorkflowMatchNode),
    Poller(WorkflowPollerNode),
    Provider(WorkflowProviderNode),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowMatchNode {
    #[serde(default)]
    pub branches: Vec<WorkflowBranch>,
    #[serde(default)]
    pub default_next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowBranch {
    pub id: String,
    pub match_type: MatchType,
    pub pattern: String,
    #[serde(default)]
    pub fuzzy_match: bool,
    pub next_node_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PollerStrategy {
    RoundRobin,
    Weighted,
    #[serde(alias = "weighted_network_status")]
    NetworkStatus,
    TokenRemaining,
}

impl Default for PollerStrategy {
    fn default() -> Self {
        Self::Weighted
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowPollerNode {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub strategy: PollerStrategy,
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: u32,
    #[serde(default = "default_cooldown_seconds")]
    pub cooldown_seconds: u64,
    #[serde(default = "default_probe_interval_seconds")]
    pub probe_interval_seconds: u64,
    #[serde(default = "default_cycle_requests")]
    pub cycle_requests: u32,
    #[serde(default)]
    pub targets: Vec<WorkflowPollerTarget>,
    #[serde(default)]
    pub default_next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPollerTarget {
    pub id: String,
    pub label: String,
    #[serde(default = "default_target_weight")]
    pub weight: u32,
    pub next_node_id: String,
}

fn default_target_weight() -> u32 { 1 }
fn default_failure_threshold() -> u32 { 3 }
fn default_cooldown_seconds() -> u64 { 30 }
fn default_probe_interval_seconds() -> u64 { 20 }
fn default_cycle_requests() -> u32 { 10 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowProviderNode {
    pub route: CompiledRoute,
}

#[derive(Debug, Clone, Default)]
pub struct PollerCursorState {
    pub slot_index: usize,
    pub served_count: u32,
}

pub struct WorkflowRuntime {
    pub metrics: MetricsStore,
    pub poller_cursors: Arc<RwLock<HashMap<String, PollerCursorState>>>,
    pub provider_runtime: super::health::ProviderRuntimeStore,
    pub poller_runtime: super::health::PollerRuntimeStore,
}

pub fn legacy_route_table_to_workflow(table: &RouteTable) -> WorkflowPlan {
    let mut nodes = Vec::new();
    let mut branches = Vec::new();
    let root_id = format!("workflow-match-{}", table.app_id);

    for route in &table.routes {
        let provider_node_id = format!("workflow-provider-{}", route.id);
        branches.push(WorkflowBranch {
            id: route.id.clone(),
            match_type: route.match_type,
            pattern: route.pattern.clone(),
            fuzzy_match: route.fuzzy_match,
            next_node_id: provider_node_id.clone(),
        });
        nodes.push(WorkflowNode {
            id: provider_node_id,
            kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                route: route.clone(),
            }),
        });
    }

    let default_next = table.default_route.as_ref().map(|route| {
        let provider_node_id = format!("workflow-provider-{}", route.id);
        nodes.push(WorkflowNode {
            id: provider_node_id.clone(),
            kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                route: route.clone(),
            }),
        });
        provider_node_id
    });

    nodes.push(WorkflowNode {
        id: root_id.clone(),
        kind: WorkflowNodeKind::Match(WorkflowMatchNode {
            branches,
            default_next,
        }),
    });

    WorkflowPlan {
        entry_node_id: root_id,
        nodes,
    }
}

pub fn ensure_route_table_workflow(table: &mut RouteTable) {
    if table.workflow.is_none() {
        table.workflow = Some(legacy_route_table_to_workflow(table));
    }
}

pub async fn execute_workflow(
    plan: &WorkflowPlan,
    runtime: &WorkflowRuntime,
    path: &str,
    headers: &HeaderMap,
    model: Option<&str>,
) -> Result<CompiledRoute, ProxyError> {
    if plan.is_empty() {
        return Err(ProxyError::InvalidConfig(
            "workflow plan is empty for the current application".to_string(),
        ));
    }

    let request = WorkflowRequestView { path, headers, model };
    execute_node(plan, &plan.entry_node_id, runtime, &request, false, 0).await
}

async fn execute_node(
    plan: &WorkflowPlan,
    node_id: &str,
    runtime: &WorkflowRuntime,
    request: &WorkflowRequestView<'_>,
    peek_only: bool,
    depth: usize,
) -> Result<CompiledRoute, ProxyError> {
    if depth > 64 {
        return Err(ProxyError::InvalidConfig(
            "workflow traversal exceeded maximum depth".to_string(),
        ));
    }

    let node = plan.node(node_id).ok_or_else(|| {
        ProxyError::InvalidConfig(format!(
            "workflow node '{}' not found in runtime plan",
            node_id
        ))
    })?;

    match &node.kind {
        WorkflowNodeKind::Match(match_node) => {
            if let Some(next_node_id) =
                match_branches(&match_node.branches, request.path, request.headers, request.model)
            {
                let branch_result = Box::pin(execute_node(
                    plan,
                    next_node_id,
                    runtime,
                    request,
                    peek_only,
                    depth + 1,
                ))
                .await;
                if !matches!(branch_result, Err(ProxyError::NoMatch)) {
                    return branch_result;
                }
            }

            if let Some(default_next) = &match_node.default_next {
                return Box::pin(execute_node(
                    plan,
                    default_next,
                    runtime,
                    request,
                    peek_only,
                    depth + 1,
                ))
                .await;
            }

            Err(ProxyError::NoMatch)
        }
        WorkflowNodeKind::Poller(poller_node) => {
            execute_poller(plan, node_id, poller_node, runtime, request, peek_only, depth + 1).await
        }
        WorkflowNodeKind::Provider(provider_node) => {
            if provider_over_token_limit(runtime, &provider_node.route).await {
                return Err(ProxyError::NoMatch);
            }
            Ok(provider_node.route.clone())
        }
    }
}

async fn execute_poller(
    plan: &WorkflowPlan,
    node_id: &str,
    poller_node: &WorkflowPollerNode,
    runtime: &WorkflowRuntime,
    request: &WorkflowRequestView<'_>,
    peek_only: bool,
    depth: usize,
) -> Result<CompiledRoute, ProxyError> {
    let mut candidates: Vec<(String, String, u32, CompiledRoute)> = Vec::new();
    for target in &poller_node.targets {
        let weight = target_effective_weight(poller_node.strategy, target.weight);
        let route_result = Box::pin(execute_node(
            plan,
            &target.next_node_id,
            runtime,
            request,
            true,
            depth + 1,
        ))
        .await;
        let route = match route_result {
            Ok(route) => route,
            Err(ProxyError::NoMatch) => continue,
            Err(other) => return Err(other),
        };
        candidates.push((
            target.next_node_id.clone(),
            target.label.clone(),
            weight,
            route,
        ));
    }

    if candidates.is_empty() {
        if let Some(default_next) = &poller_node.default_next {
            return Box::pin(execute_node(
                plan,
                default_next,
                runtime,
                request,
                peek_only,
                depth + 1,
            ))
            .await;
        }
        return Err(ProxyError::NoMatch);
    }

    let selected_next = match poller_node.strategy {
        PollerStrategy::RoundRobin => {
            select_weighted(node_id, &candidates, &runtime.poller_cursors, poller_node.cycle_requests, peek_only).await
        }
        PollerStrategy::Weighted => {
            select_weighted(node_id, &candidates, &runtime.poller_cursors, poller_node.cycle_requests, peek_only).await
        }
        PollerStrategy::NetworkStatus => {
            select_by_network_status(node_id, &candidates, runtime, poller_node, peek_only).await
        }
        PollerStrategy::TokenRemaining => {
            select_by_token_remaining(node_id, &candidates, runtime, poller_node, peek_only).await
        }
    };

    let route = Box::pin(execute_node(
        plan,
        &selected_next,
        runtime,
        request,
        peek_only,
        depth + 1,
    ))
    .await?;

    if !peek_only {
        let cursor_state = runtime
            .poller_cursors
            .read()
            .await
            .get(node_id)
            .cloned()
            .unwrap_or_default();
        let target_configs: Vec<(String, String, u32)> = candidates
            .iter()
            .map(|(next_node_id, target_label, target_weight, _)| {
                (next_node_id.clone(), target_label.clone(), *target_weight)
            })
            .collect();
        if let Some((_, selected_target_label, selected_target_weight, _)) = candidates
            .iter()
            .find(|(next_node_id, _, _, _)| next_node_id == &selected_next)
        {
            // Find the actual target ID from the weighted slot for monitoring
            let weighted: Vec<&(String, String, u32, CompiledRoute)> = candidates
                .iter()
                .flat_map(|c| std::iter::repeat_n(c, c.2.max(1) as usize))
                .collect();
            let current_slot_target_id = if !weighted.is_empty() {
                weighted[cursor_state.slot_index % weighted.len()].0.clone()
            } else {
                selected_next.clone()
            };

            runtime
            .poller_runtime
            .record_selection(
                node_id,
                &poller_node.label,
                map_runtime_strategy(poller_node.strategy),
                cursor_state.slot_index,
                poller_node.failure_threshold,
                poller_node.cooldown_seconds,
                poller_node.probe_interval_seconds,
                poller_node.cycle_requests,
                cursor_state.served_count,
                &current_slot_target_id,
                &target_configs,
                &selected_next,
                selected_target_label,
                *selected_target_weight,
                &route.provider_id,
                &route.provider_label,
            )
            .await;
        }
    }

    Ok(route)
}

async fn select_weighted(
    node_id: &str,
    candidates: &[(String, String, u32, CompiledRoute)],
    cursors: &Arc<RwLock<HashMap<String, PollerCursorState>>>,
    cycle_requests: u32,
    peek_only: bool,
) -> String {
    let weighted: Vec<&(String, String, u32, CompiledRoute)> = candidates
        .iter()
        .flat_map(|candidate| std::iter::repeat_n(candidate, candidate.2.max(1) as usize))
        .collect();
    if weighted.is_empty() {
        return candidates[0].0.clone();
    }

    let effective_cycle = cycle_requests.max(1);

    let next_index = {
        let mut state = cursors.write().await;
        let cursor_state = state.entry(node_id.to_string()).or_default();
        let total_slots = weighted.len();

        // Reset if slot_index is out of bounds (candidate list changed)
        if cursor_state.slot_index >= total_slots {
            cursor_state.slot_index = 0;
            cursor_state.served_count = 0;
        }

        let index = cursor_state.slot_index;
        if !peek_only {
            cursor_state.served_count += 1;
            if cursor_state.served_count >= effective_cycle {
                cursor_state.slot_index = (index + 1) % total_slots;
                cursor_state.served_count = 0;
            }
        }
        index
    };
    weighted[next_index].0.clone()
}

async fn select_by_network_status(
    node_id: &str,
    candidates: &[(String, String, u32, CompiledRoute)],
    runtime: &WorkflowRuntime,
    poller_node: &WorkflowPollerNode,
    peek_only: bool,
) -> String {
    let mut scored: Vec<(usize, String)> = Vec::new();
    for (next_node_id, _, _, route) in candidates {
        runtime
            .provider_runtime
            .apply_policy(
                &route.provider_id,
                &route.provider_label,
                route.token_limit.unwrap_or(0),
                poller_node.failure_threshold,
                poller_node.cooldown_seconds,
                poller_node.probe_interval_seconds,
            )
            .await;
        let runtime_state = prepare_runtime_state(runtime, route, poller_node).await;
        if let Some(runtime_state) = runtime_state {
            let score = match runtime_state.status {
                super::types::ProviderRuntimeStatus::Healthy => 3usize,
                super::types::ProviderRuntimeStatus::HalfOpen => 2usize,
                super::types::ProviderRuntimeStatus::Unknown => 2usize,
                super::types::ProviderRuntimeStatus::Degraded => 1usize,
                super::types::ProviderRuntimeStatus::CircuitOpen => 0usize,
            };
            scored.push((score, next_node_id.clone()));
            continue;
        }
        let latest = runtime.metrics.latest_provider_request(&route.provider_id).await;
        let score = match latest {
            Some(request) if request.success => 2usize,
            Some(_) => 0usize,
            None => 1usize,
        };
        scored.push((score, next_node_id.clone()));
    }

    let best_score = scored.iter().map(|(score, _)| *score).max().unwrap_or(0);
    let filtered: Vec<String> = scored
        .into_iter()
        .filter(|(score, _)| *score == best_score)
        .map(|(_, node_id)| node_id)
        .collect();

    if filtered.len() == 1 {
        return filtered[0].clone();
    }

    let rr_candidates: Vec<(String, String, u32, CompiledRoute)> = candidates
        .iter()
        .filter(|(next_node_id, _, _, _)| filtered.contains(next_node_id))
        .cloned()
        .collect();
    select_weighted(node_id, &rr_candidates, &runtime.poller_cursors, poller_node.cycle_requests, peek_only).await
}

async fn select_by_token_remaining(
    node_id: &str,
    candidates: &[(String, String, u32, CompiledRoute)],
    runtime: &WorkflowRuntime,
    poller_node: &WorkflowPollerNode,
    peek_only: bool,
) -> String {
    let mut best_remaining: Option<u64> = None;
    let mut best: Vec<(String, String, u32, CompiledRoute)> = Vec::new();

    for (next_node_id, target_label, weight, route) in candidates {
        let used = runtime
            .metrics
            .provider_summary(&route.provider_id)
            .await
            .map(|summary| summary.summary.total_tokens)
            .unwrap_or(0);
        let remaining = route
            .token_limit
            .map(|limit| limit.saturating_sub(used))
            .unwrap_or(u64::MAX);

        match best_remaining {
            None => {
                best_remaining = Some(remaining);
                best = vec![(next_node_id.clone(), target_label.clone(), *weight, route.clone())];
            }
            Some(current) if remaining > current => {
                best_remaining = Some(remaining);
                best = vec![(next_node_id.clone(), target_label.clone(), *weight, route.clone())];
            }
            Some(current) if remaining == current => {
                best.push((next_node_id.clone(), target_label.clone(), *weight, route.clone()));
            }
            _ => {}
        }
    }

    select_weighted(node_id, &best, &runtime.poller_cursors, poller_node.cycle_requests, peek_only).await
}

fn map_runtime_strategy(strategy: PollerStrategy) -> PollerStrategyRuntime {
    match strategy {
        PollerStrategy::RoundRobin => PollerStrategyRuntime::Weighted,
        PollerStrategy::Weighted => PollerStrategyRuntime::Weighted,
        PollerStrategy::NetworkStatus => PollerStrategyRuntime::NetworkStatus,
        PollerStrategy::TokenRemaining => PollerStrategyRuntime::TokenRemaining,
    }
}

fn target_effective_weight(strategy: PollerStrategy, configured_weight: u32) -> u32 {
    match strategy {
        PollerStrategy::Weighted => configured_weight.max(1),
        PollerStrategy::RoundRobin | PollerStrategy::NetworkStatus | PollerStrategy::TokenRemaining => 1,
    }
}

async fn prepare_runtime_state(
    runtime: &WorkflowRuntime,
    route: &CompiledRoute,
    poller_node: &WorkflowPollerNode,
) -> Option<super::types::ProviderRuntimeState> {
    runtime
        .provider_runtime
        .apply_policy(
            &route.provider_id,
            &route.provider_label,
            route.token_limit.unwrap_or(0),
            poller_node.failure_threshold,
            poller_node.cooldown_seconds,
            poller_node.probe_interval_seconds,
        )
        .await;
    let state = runtime.provider_runtime.get(&route.provider_id).await;
    match state {
        Some(current) if circuit_open(Utc::now(), &current.circuit_open_until) => Some(current),
        Some(current) if current.status == super::types::ProviderRuntimeStatus::CircuitOpen => {
            runtime.provider_runtime.try_enter_half_open(&route.provider_id).await
        }
        other => other,
    }
}


fn match_branches<'a>(
    branches: &'a [WorkflowBranch],
    path: &str,
    headers: &HeaderMap,
    model: Option<&str>,
) -> Option<&'a str> {
    for branch in branches {
        if matches!(branch.match_type, MatchType::PathPrefix) && path.starts_with(&branch.pattern) {
            return Some(branch.next_node_id.as_str());
        }
    }

    for branch in branches {
        if matches!(branch.match_type, MatchType::Header) {
            if let Some((header_name, header_value)) = branch.pattern.split_once(':') {
                let matched = headers
                    .get(header_name)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value == header_value)
                    .unwrap_or(false);
                if matched {
                    return Some(branch.next_node_id.as_str());
                }
            }
        }
    }

    if let Some(request_model) = model {
        for branch in branches {
            if matches!(branch.match_type, MatchType::Model) {
                let matched = if branch.fuzzy_match {
                    request_model.contains(&branch.pattern)
                } else {
                    request_model == branch.pattern
                };
                if matched {
                    return Some(branch.next_node_id.as_str());
                }
            }
        }
    }

    None
}

struct WorkflowRequestView<'a> {
    path: &'a str,
    headers: &'a HeaderMap,
    model: Option<&'a str>,
}

async fn provider_over_token_limit(runtime: &WorkflowRuntime, route: &CompiledRoute) -> bool {
    let Some(limit) = route.token_limit else {
        return false;
    };
    let used = runtime
        .metrics
        .provider_summary(&route.provider_id)
        .await
        .map(|summary| summary.summary.total_tokens)
        .unwrap_or(0);
    used >= limit
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proxy::health::{PollerRuntimeStore, ProviderRuntimeStore};
    use crate::proxy::types::{ProviderRuntimeStatus, ProxyRequestMetric};

    fn runtime() -> WorkflowRuntime {
        WorkflowRuntime {
            metrics: MetricsStore::new(),
            poller_cursors: Arc::new(RwLock::new(HashMap::new())),
            provider_runtime: ProviderRuntimeStore::new(),
            poller_runtime: PollerRuntimeStore::new(),
        }
    }

    fn make_route(id: &str, match_type: MatchType, pattern: &str) -> CompiledRoute {
        CompiledRoute {
            id: id.to_string(),
            match_type,
            pattern: pattern.to_string(),
            provider_id: format!("provider-{id}"),
            provider_label: "Provider 1".to_string(),
            upstream_url: "https://upstream.example.com".to_string(),
            anthropic_upstream_url: None,
            api_key: "test-key".to_string(),
            extra_headers: HashMap::new(),
            is_default: false,
            target_model: String::new(),
            token_limit: None,
            fuzzy_match: false,
        }
    }

    async fn record_provider_usage(runtime: &WorkflowRuntime, provider_id: &str, total_tokens: u64) {
        let now = Utc::now().to_rfc3339();
        runtime
            .metrics
            .record(ProxyRequestMetric {
                id: String::new(),
                app_id: "app-1".to_string(),
                app_label: "App 1".to_string(),
                provider_id: provider_id.to_string(),
                provider_label: provider_id.to_string(),
                listen_port: 9527,
                method: "POST".to_string(),
                path: "/v1/messages".to_string(),
                protocol: "openai".to_string(),
                request_model: None,
                target_model: None,
                response_model: None,
                status_code: Some(200),
                success: true,
                streamed: false,
                duration_ms: 10,
                input_tokens: total_tokens,
                output_tokens: 0,
                total_tokens,
                started_at: now.clone(),
                completed_at: now,
                error: None,
            })
            .await;
    }

    fn make_table() -> RouteTable {
        RouteTable {
            app_id: "app-1".to_string(),
            app_label: "App 1".to_string(),
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
            routes: vec![
                make_route("path", MatchType::PathPrefix, "/v1/messages"),
                make_route("header", MatchType::Header, "X-Flag:yes"),
                make_route("model", MatchType::Model, "gpt-4o"),
            ],
            default_route: Some(CompiledRoute {
                id: "default".to_string(),
                is_default: true,
                ..make_route("default", MatchType::PathPrefix, "")
            }),
            workflow: None,
        }
    }

    #[test]
    fn legacy_adapter_keeps_default_and_routes() {
        let table = make_table();
        let plan = legacy_route_table_to_workflow(&table);

        assert_eq!(plan.entry_node_id, "workflow-match-app-1");
        assert_eq!(plan.nodes.len(), 5);
    }

    #[tokio::test]
    async fn execute_workflow_matches_with_legacy_priority() {
        let table = make_table();
        let plan = legacy_route_table_to_workflow(&table);
        let mut headers = HeaderMap::new();
        headers.insert("x-flag", "yes".parse().unwrap());

        let route = execute_workflow(&plan, &runtime(), "/v1/messages", &headers, Some("gpt-4o"))
            .await
            .unwrap();
        assert_eq!(route.id, "path");
    }

    #[tokio::test]
    async fn execute_workflow_falls_back_to_default() {
        let table = make_table();
        let plan = legacy_route_table_to_workflow(&table);
        let headers = HeaderMap::new();

        let route = execute_workflow(&plan, &runtime(), "/unknown", &headers, None)
            .await
            .unwrap();
        assert_eq!(route.id, "default");
        assert!(route.is_default);
    }

    #[tokio::test]
    async fn execute_workflow_supports_nested_match_nodes() {
        let terminal = make_route("provider-final", MatchType::PathPrefix, "/unused");
        let plan = WorkflowPlan {
            entry_node_id: "root".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "root".to_string(),
                    kind: WorkflowNodeKind::Match(WorkflowMatchNode {
                        branches: vec![WorkflowBranch {
                            id: "b1".to_string(),
                            match_type: MatchType::Header,
                            pattern: "X-Tier:gold".to_string(),
                            fuzzy_match: false,
                            next_node_id: "nested".to_string(),
                        }],
                        default_next: Some("provider".to_string()),
                    }),
                },
                WorkflowNode {
                    id: "nested".to_string(),
                    kind: WorkflowNodeKind::Match(WorkflowMatchNode {
                        branches: vec![WorkflowBranch {
                            id: "b2".to_string(),
                            match_type: MatchType::Model,
                            pattern: "gpt-4o".to_string(),
                            fuzzy_match: false,
                            next_node_id: "provider".to_string(),
                        }],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route: terminal }),
                },
            ],
        };

        let mut headers = HeaderMap::new();
        headers.insert("x-tier", "gold".parse().unwrap());
        let route = execute_workflow(&plan, &runtime(), "/v1/chat", &headers, Some("gpt-4o"))
            .await
            .unwrap();
        assert_eq!(route.id, "provider-final");
    }

    #[tokio::test]
    async fn poller_legacy_round_robin_behaves_like_weighted_equal_weights() {
        let plan = WorkflowPlan {
            entry_node_id: "poller".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "poller".to_string(),
                    kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
                        label: "Poller".to_string(),
                        strategy: PollerStrategy::RoundRobin,
                        failure_threshold: 3,
                        cooldown_seconds: 30,
                        probe_interval_seconds: 20,
                        cycle_requests: 1,
                        targets: vec![
                            WorkflowPollerTarget {
                                id: "a".to_string(),
                                label: "A".to_string(),
                                weight: 1,
                                next_node_id: "provider-a".to_string(),
                            },
                            WorkflowPollerTarget {
                                id: "b".to_string(),
                                label: "B".to_string(),
                                weight: 1,
                                next_node_id: "provider-b".to_string(),
                            },
                        ],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("a", MatchType::PathPrefix, "/"),
                    }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("b", MatchType::PathPrefix, "/"),
                    }),
                },
            ],
        };

        let runtime = runtime();
        let headers = HeaderMap::new();
        let first = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        let second = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        assert_eq!(first.id, "a");
        assert_eq!(second.id, "b");
    }

    #[tokio::test]
    async fn token_remaining_uses_default_budget_when_missing() {
        let mut route_a = make_route("a", MatchType::PathPrefix, "/");
        route_a.token_limit = None;
        let mut route_b = make_route("b", MatchType::PathPrefix, "/");
        route_b.token_limit = Some(500_000);

        let plan = WorkflowPlan {
            entry_node_id: "poller".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "poller".to_string(),
                    kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
                        label: "Poller".to_string(),
                        strategy: PollerStrategy::TokenRemaining,
                        failure_threshold: 3,
                        cooldown_seconds: 30,
                        probe_interval_seconds: 20,
                        cycle_requests: 10,
                        targets: vec![
                            WorkflowPollerTarget {
                                id: "a".to_string(),
                                label: "A".to_string(),
                                weight: 1,
                                next_node_id: "provider-a".to_string(),
                            },
                            WorkflowPollerTarget {
                                id: "b".to_string(),
                                label: "B".to_string(),
                                weight: 1,
                                next_node_id: "provider-b".to_string(),
                            },
                        ],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route: route_a }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route: route_b }),
                },
            ],
        };

        let runtime = runtime();
        let headers = HeaderMap::new();
        let selected = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        assert_eq!(selected.id, "a");
    }

    #[tokio::test]
    async fn provider_is_not_routed_when_usage_reaches_limit() {
        let mut route = make_route("a", MatchType::PathPrefix, "/");
        route.token_limit = Some(100);
        let plan = WorkflowPlan {
            entry_node_id: "provider-a".to_string(),
            nodes: vec![WorkflowNode {
                id: "provider-a".to_string(),
                kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route }),
            }],
        };

        let runtime = runtime();
        record_provider_usage(&runtime, "provider-a", 100).await;
        let headers = HeaderMap::new();
        let result = execute_workflow(&plan, &runtime, "/", &headers, None).await;
        assert!(matches!(result, Err(ProxyError::NoMatch)));
    }

    #[tokio::test]
    async fn match_node_falls_back_to_default_when_matched_provider_over_limit() {
        let mut primary = make_route("a", MatchType::PathPrefix, "/v1/messages");
        primary.token_limit = Some(100);
        let fallback = make_route("b", MatchType::PathPrefix, "/");
        let plan = WorkflowPlan {
            entry_node_id: "match".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "match".to_string(),
                    kind: WorkflowNodeKind::Match(WorkflowMatchNode {
                        branches: vec![WorkflowBranch {
                            id: "branch-a".to_string(),
                            match_type: MatchType::PathPrefix,
                            pattern: "/v1/messages".to_string(),
                            fuzzy_match: false,
                            next_node_id: "provider-a".to_string(),
                        }],
                        default_next: Some("provider-b".to_string()),
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route: primary }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route: fallback }),
                },
            ],
        };

        let runtime = runtime();
        record_provider_usage(&runtime, "provider-a", 100).await;
        let headers = HeaderMap::new();
        let selected = execute_workflow(&plan, &runtime, "/v1/messages", &headers, None)
            .await
            .unwrap();
        assert_eq!(selected.id, "b");
    }

    #[tokio::test]
    async fn network_status_skips_circuit_open_provider() {
        let plan = WorkflowPlan {
            entry_node_id: "poller".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "poller".to_string(),
                    kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
                        label: "Health Poller".to_string(),
                        strategy: PollerStrategy::NetworkStatus,
                        failure_threshold: 3,
                        cooldown_seconds: 30,
                        probe_interval_seconds: 20,
                        cycle_requests: 10,
                        targets: vec![
                            WorkflowPollerTarget {
                                id: "a".to_string(),
                                label: "A".to_string(),
                                weight: 1,
                                next_node_id: "provider-a".to_string(),
                            },
                            WorkflowPollerTarget {
                                id: "b".to_string(),
                                label: "B".to_string(),
                                weight: 1,
                                next_node_id: "provider-b".to_string(),
                            },
                        ],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("a", MatchType::PathPrefix, "/"),
                    }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("b", MatchType::PathPrefix, "/"),
                    }),
                },
            ],
        };

        let runtime = runtime();
        runtime
            .provider_runtime
            .record_request_result(
                "provider-a",
                "Provider A",
                1_000_000,
                0,
                false,
                Some("upstream timeout".to_string()),
            )
            .await;
        runtime
            .provider_runtime
            .record_request_result(
                "provider-a",
                "Provider A",
                1_000_000,
                0,
                false,
                Some("upstream timeout".to_string()),
            )
            .await;
        runtime
            .provider_runtime
            .record_request_result(
                "provider-a",
                "Provider A",
                1_000_000,
                0,
                false,
                Some("upstream timeout".to_string()),
            )
            .await;

        let headers = HeaderMap::new();
        let selected = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        assert_eq!(selected.id, "b");
    }

    #[tokio::test]
    async fn weighted_strategy_respects_target_weights() {
        let plan = WorkflowPlan {
            entry_node_id: "poller".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "poller".to_string(),
                    kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
                        label: "Weighted Poller".to_string(),
                        strategy: PollerStrategy::Weighted,
                        failure_threshold: 3,
                        cooldown_seconds: 30,
                        probe_interval_seconds: 20,
                        cycle_requests: 1,
                        targets: vec![
                            WorkflowPollerTarget {
                                id: "a".to_string(),
                                label: "A".to_string(),
                                weight: 2,
                                next_node_id: "provider-a".to_string(),
                            },
                            WorkflowPollerTarget {
                                id: "b".to_string(),
                                label: "B".to_string(),
                                weight: 1,
                                next_node_id: "provider-b".to_string(),
                            },
                        ],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("a", MatchType::PathPrefix, "/"),
                    }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("b", MatchType::PathPrefix, "/"),
                    }),
                },
            ],
        };

        let runtime = runtime();
        let headers = HeaderMap::new();
        let first = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        let second = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        let third = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        assert_eq!(first.id, "a");
        assert_eq!(second.id, "a");
        assert_eq!(third.id, "b");
    }

    #[tokio::test]
    async fn network_status_ignores_target_weights() {
        let plan = WorkflowPlan {
            entry_node_id: "poller".to_string(),
            nodes: vec![
                WorkflowNode {
                    id: "poller".to_string(),
                    kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
                        label: "Smart Poller".to_string(),
                        strategy: PollerStrategy::NetworkStatus,
                        failure_threshold: 3,
                        cooldown_seconds: 30,
                        probe_interval_seconds: 20,
                        cycle_requests: 1,
                        targets: vec![
                            WorkflowPollerTarget {
                                id: "a".to_string(),
                                label: "A".to_string(),
                                weight: 3,
                                next_node_id: "provider-a".to_string(),
                            },
                            WorkflowPollerTarget {
                                id: "b".to_string(),
                                label: "B".to_string(),
                                weight: 1,
                                next_node_id: "provider-b".to_string(),
                            },
                        ],
                        default_next: None,
                    }),
                },
                WorkflowNode {
                    id: "provider-a".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("a", MatchType::PathPrefix, "/"),
                    }),
                },
                WorkflowNode {
                    id: "provider-b".to_string(),
                    kind: WorkflowNodeKind::Provider(WorkflowProviderNode {
                        route: make_route("b", MatchType::PathPrefix, "/"),
                    }),
                },
            ],
        };

        let runtime = runtime();
        let headers = HeaderMap::new();
        let first = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        let second = execute_workflow(&plan, &runtime, "/", &headers, None).await.unwrap();
        assert_eq!(first.id, "a");
        assert_eq!(second.id, "b");
    }

    #[tokio::test]
    async fn half_open_is_entered_after_cooldown() {
        let runtime = runtime();
        runtime
            .provider_runtime
            .record_request_result("provider-a", "Provider A", 1_000_000, 0, false, Some("timeout".to_string()))
            .await;
        runtime
            .provider_runtime
            .record_request_result("provider-a", "Provider A", 1_000_000, 0, false, Some("timeout".to_string()))
            .await;
        runtime
            .provider_runtime
            .record_request_result("provider-a", "Provider A", 1_000_000, 0, false, Some("timeout".to_string()))
            .await;

        runtime
            .provider_runtime
            .expire_circuit_open_for_test("provider-a")
            .await;

        let route = CompiledRoute { provider_id: "provider-a".to_string(), provider_label: "Provider A".to_string(), ..make_route("a", MatchType::PathPrefix, "/") };
        let poller = WorkflowPollerNode {
            label: "Smart Poller".to_string(),
            strategy: PollerStrategy::NetworkStatus,
            failure_threshold: 3,
            cooldown_seconds: 1,
            probe_interval_seconds: 20,
            cycle_requests: 10,
            targets: vec![],
            default_next: None,
        };
        let state = prepare_runtime_state(&runtime, &route, &poller).await.unwrap();
        assert_eq!(state.status, ProviderRuntimeStatus::HalfOpen);
    }
}
