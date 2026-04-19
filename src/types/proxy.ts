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

/** A single application's compiled route table. */
export interface RouteTable {
  /** The Application node ID this route table belongs to. */
  app_id: string;
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
  upstream_url: string;
  anthropic_upstream_url: string | null;
  api_key: string;
  extra_headers: Record<string, string>;
  is_default: boolean;
  target_model: string;
  fuzzy_match: boolean;
}
