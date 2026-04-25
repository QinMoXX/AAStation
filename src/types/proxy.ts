/** Runtime status of the proxy server. */
export interface ProxyStatus {
  running: boolean;
  /** The first (primary) port. For full list, use `listen_ports`. */
  port: number;
  /** All ports currently being listened on. */
  listen_ports: number[];
  published_at: string | null;
  active_routes: number;
  total_requests: number;
  uptime_seconds: number;
}

export interface ProxyMetricsSummary {
  requests: number;
  successful_requests: number;
  failed_requests: number;
  streamed_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_latency_ms: number;
  last_request_at: string | null;
}

export interface ProxyMetricsEntitySummary {
  id: string;
  label: string;
  requests: number;
  successful_requests: number;
  failed_requests: number;
  streamed_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_latency_ms: number;
  last_request_at: string | null;
}

export interface ProxyMetricsPairSummary {
  app_id: string;
  app_label: string;
  provider_id: string;
  provider_label: string;
  requests: number;
  successful_requests: number;
  failed_requests: number;
  streamed_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_latency_ms: number;
  last_request_at: string | null;
}

export interface ProxyRequestMetric {
  id: string;
  app_id: string;
  app_label: string;
  provider_id: string;
  provider_label: string;
  listen_port: number;
  method: string;
  path: string;
  protocol: string;
  request_model: string | null;
  target_model: string | null;
  response_model: string | null;
  status_code: number | null;
  success: boolean;
  streamed: boolean;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  started_at: string;
  completed_at: string;
  error: string | null;
}

export interface ProxyMetricsSnapshot {
  generated_at: string;
  summary: ProxyMetricsSummary;
  applications: ProxyMetricsEntitySummary[];
  providers: ProxyMetricsEntitySummary[];
  app_provider_pairs: ProxyMetricsPairSummary[];
  recent_requests: ProxyRequestMetric[];
  provider_runtime: ProviderRuntimeState[];
  poller_runtime: PollerRuntimeState[];
}

export type ProviderRuntimeStatus = 'unknown' | 'healthy' | 'half_open' | 'degraded' | 'circuit_open';

export interface ProviderRuntimeEvent {
  at: string;
  kind: string;
  detail: string;
}

export interface ProviderRuntimeState {
  provider_id: string;
  provider_label: string;
  status: ProviderRuntimeStatus;
  failure_threshold: number;
  cooldown_seconds: number;
  probe_interval_seconds: number;
  consecutive_failures: number;
  last_request_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_probe_at: string | null;
  last_error: string | null;
  circuit_open_until: string | null;
  half_open_since: string | null;
  circuit_open_count: number;
  recovery_attempts: number;
  timeline: ProviderRuntimeEvent[];
  budget_tokens: number;
  remaining_tokens: number;
}

export type PollerStrategyRuntime = 'weighted' | 'network_status' | 'token_remaining';

export interface PollerTargetRuntimeStat {
  target_id: string;
  target_label: string;
  configured_weight: number;
  hits: number;
  last_selected_at: string | null;
  last_selected_provider_label: string | null;
}

export interface PollerRuntimeState {
  poller_id: string;
  poller_label: string;
  strategy: PollerStrategyRuntime;
  cursor: number;
  failure_threshold: number;
  cooldown_seconds: number;
  probe_interval_seconds: number;
  total_selections: number;
  last_selected_target: string | null;
  last_selected_provider_id: string | null;
  last_selected_provider_label: string | null;
  last_selected_at: string | null;
  target_stats: PollerTargetRuntimeStat[];
}

/** A single application's compiled route table. */
export interface RouteTable {
  /** The Application node ID this route table belongs to. */
  app_id: string;
  app_label: string;
  /** The port this application's proxy listens on. */
  listen_port: number;
  listen_address: string;
  routes: CompiledRoute[];
  default_route: CompiledRoute | null;
}

/** The full set of compiled route tables, one per Application node. */
export interface RouteTableSet {
  /** Address all listeners bind to. */
  listen_address: string;
  /** Per-application route tables. */
  tables: RouteTable[];
}

/** A single compiled route entry. */
export interface CompiledRoute {
  id: string;
  match_type: 'path_prefix' | 'header' | 'model';
  pattern: string;
  provider_id: string;
  provider_label: string;
  upstream_url: string;
  anthropic_upstream_url: string | null;
  api_key: string;
  extra_headers: Record<string, string>;
  is_default: boolean;
  target_model: string;
  token_limit?: number | null;
  fuzzy_match: boolean;
}
