#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::workflow::WorkflowPlan;

/// The protocol style of an incoming client request, detected from the request path.
/// This determines how the request body is interpreted before protocol adaptation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestProtocol {
    /// OpenAI-style: POST /v1/chat/completions, body has "messages"
    OpenAI,
    /// Anthropic-style: POST /v1/messages, body has "messages" + "max_tokens"
    Anthropic,
}

/// Compiled routing table — output of DAG compilation.
/// Each Application node produces its own RouteTable with a dedicated listen port.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RouteTable {
    /// The Application node ID this route table belongs to.
    pub app_id: String,
    /// Human-friendly label for the application node.
    #[serde(default)]
    pub app_label: String,
    /// The port this application's proxy listens on.
    pub listen_port: u16,
    /// The address the proxy binds to.
    pub listen_address: String,
    pub routes: Vec<CompiledRoute>,
    pub default_route: Option<CompiledRoute>,
    /// Runtime workflow plan used by the node-driven executor.
    /// During migration this is auto-derived from `routes/default_route`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<WorkflowPlan>,
}

impl RouteTable {
    pub fn is_empty(&self) -> bool {
        let has_workflow = self
            .workflow
            .as_ref()
            .map(|workflow| !workflow.is_empty())
            .unwrap_or(false);
        !has_workflow && self.routes.is_empty() && self.default_route.is_none()
    }
}

/// The full set of compiled route tables, one per Application node.
/// This is the output of DAG compilation and the unit hot-loaded into the proxy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RouteTableSet {
    /// Address all listeners bind to.
    pub listen_address: String,
    /// Per-application route tables.
    pub tables: Vec<RouteTable>,
}

impl RouteTableSet {
    pub fn is_empty(&self) -> bool {
        self.tables.iter().all(|t| t.is_empty())
    }
    
    /// Find the route table for a specific port.
    pub fn table_for_port(&self, port: u16) -> Option<&RouteTable> {
        self.tables.iter().find(|t| t.listen_port == port)
    }
}

/// A single compiled route entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledRoute {
    pub id: String,
    pub match_type: MatchType,
    pub pattern: String,
    /// The Provider node ID that this route resolves to.
    #[serde(default)]
    pub provider_id: String,
    /// Human-friendly Provider label.
    #[serde(default)]
    pub provider_label: String,
    /// OpenAI-compatible upstream URL. Used for OpenAI-style requests.
    pub upstream_url: String,
    /// Anthropic-compatible upstream URL (optional). When set, Anthropic-style client
    /// requests will be forwarded to this URL instead of upstream_url.
    #[serde(default)]
    pub anthropic_upstream_url: Option<String>,
    pub api_key: String,
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
    pub is_default: bool,
    /// Target model name to replace in the request body when forwarding.
    /// If empty, the original model is kept.
    #[serde(default)]
    pub target_model: String,
    /// Token budget in absolute tokens used by token-aware pollers.
    /// Compiled from the Provider form's "million tokens" unit.
    #[serde(default)]
    pub token_limit: Option<u64>,
    /// Whether to use substring matching for model patterns.
    /// When true, pattern matches if it is a substring of the request model.
    /// This is used for Claude Code connections where model names like
    /// "claude-haiku-4-5-20251001" should match pattern "claude-haiku".
    #[serde(default)]
    pub fuzzy_match: bool,
}

/// Aggregated usage counters shared by monitoring views.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyMetricsSummary {
    pub requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub streamed_requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub total_latency_ms: u64,
    pub last_request_at: Option<String>,
}

/// Summary for a single application or provider dimension.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyMetricsEntitySummary {
    pub id: String,
    pub label: String,
    #[serde(flatten)]
    pub summary: ProxyMetricsSummary,
}

/// Summary for an application-provider combination.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyMetricsPairSummary {
    pub app_id: String,
    pub app_label: String,
    pub provider_id: String,
    pub provider_label: String,
    #[serde(flatten)]
    pub summary: ProxyMetricsSummary,
}

/// A single observed API request recorded by the local proxy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyRequestMetric {
    pub id: String,
    pub app_id: String,
    pub app_label: String,
    pub provider_id: String,
    pub provider_label: String,
    pub listen_port: u16,
    pub method: String,
    pub path: String,
    pub protocol: String,
    pub request_model: Option<String>,
    pub target_model: Option<String>,
    pub response_model: Option<String>,
    pub status_code: Option<u16>,
    pub success: bool,
    pub streamed: bool,
    pub duration_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub started_at: String,
    pub completed_at: String,
    pub error: Option<String>,
}

/// Snapshot returned to the frontend monitor page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyMetricsSnapshot {
    pub generated_at: String,
    pub summary: ProxyMetricsSummary,
    pub applications: Vec<ProxyMetricsEntitySummary>,
    pub providers: Vec<ProxyMetricsEntitySummary>,
    pub app_provider_pairs: Vec<ProxyMetricsPairSummary>,
    pub recent_requests: Vec<ProxyRequestMetric>,
    #[serde(default)]
    pub provider_runtime: Vec<ProviderRuntimeState>,
    #[serde(default)]
    pub poller_runtime: Vec<PollerRuntimeState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProviderRuntimeStatus {
    #[default]
    Unknown,
    Healthy,
    HalfOpen,
    Degraded,
    CircuitOpen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderRuntimeEventKind {
    CircuitOpened,
    HalfOpened,
    Recovered,
    ProbeFailed,
    RequestFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderRuntimeEvent {
    pub at: String,
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderRuntimeState {
    pub provider_id: String,
    pub provider_label: String,
    pub status: ProviderRuntimeStatus,
    pub failure_threshold: u32,
    pub cooldown_seconds: u64,
    pub probe_interval_seconds: u64,
    pub consecutive_failures: u32,
    pub last_request_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub last_probe_at: Option<String>,
    pub last_error: Option<String>,
    pub circuit_open_until: Option<String>,
    pub half_open_since: Option<String>,
    pub circuit_open_count: u32,
    pub recovery_attempts: u32,
    #[serde(default)]
    pub timeline: Vec<ProviderRuntimeEvent>,
    pub budget_tokens: u64,
    pub remaining_tokens: u64,
    pub used_tokens: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PollerStrategyRuntime {
    #[default]
    Weighted,
    NetworkStatus,
    TokenRemaining,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PollerTargetRuntimeStat {
    pub target_id: String,
    pub target_label: String,
    pub configured_weight: u32,
    pub hits: u64,
    pub last_selected_at: Option<String>,
    pub last_selected_provider_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PollerRuntimeState {
    pub poller_id: String,
    pub poller_label: String,
    pub strategy: PollerStrategyRuntime,
    pub cursor: usize,
    pub failure_threshold: u32,
    pub cooldown_seconds: u64,
    pub probe_interval_seconds: u64,
    #[serde(default)]
    pub cycle_requests: u32,
    #[serde(default)]
    pub served_in_current_slot: u32,
    #[serde(default)]
    pub current_slot_target_id: Option<String>,
    pub total_selections: u64,
    pub last_selected_target: Option<String>,
    pub last_selected_provider_id: Option<String>,
    pub last_selected_provider_label: Option<String>,
    pub last_selected_at: Option<String>,
    #[serde(default)]
    pub target_stats: Vec<PollerTargetRuntimeStat>,
}

/// Route match strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    PathPrefix,
    Header,
    Model,
}

/// Proxy server configuration (derived from settings at publish time).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub listen_address: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            listen_address: "127.0.0.1".to_string(),
        }
    }
}

/// Runtime status of the proxy server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    /// The first (primary) port. For full list, use `listen_ports`.
    pub port: u16,
    /// All ports currently being listened on.
    #[serde(default)]
    pub listen_ports: Vec<u16>,
    pub published_at: Option<String>,
    pub active_routes: usize,
    pub active_requests: u64,
    pub total_requests: u64,
    pub uptime_seconds: u64,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 0,
            listen_ports: Vec::new(),
            published_at: None,
            active_routes: 0,
            active_requests: 0,
            total_requests: 0,
            uptime_seconds: 0,
        }
    }
}
