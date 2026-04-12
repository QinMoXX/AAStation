/** Runtime status of the proxy server. */
export interface ProxyStatus {
  running: boolean;
  port: number;
  published_at: string | null;
  active_routes: number;
  total_requests: number;
  uptime_seconds: number;
}

/** Compiled route table returned by publish_dag. */
export interface RouteTable {
  listen_port: number;
  listen_address: string;
  routes: CompiledRoute[];
  default_route: CompiledRoute | null;
}

/** A single compiled route entry. */
export interface CompiledRoute {
  id: string;
  match_type: 'path_prefix' | 'header' | 'model';
  pattern: string;
  upstream_url: string;
  api_key: string;
  extra_headers: Record<string, string>;
  is_default: boolean;
  api_type: 'anthropic' | 'openai' | null;
}
