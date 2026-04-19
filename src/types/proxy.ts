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
  fuzzy_match: boolean;
}
