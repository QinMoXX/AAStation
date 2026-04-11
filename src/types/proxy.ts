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
  routes: unknown[];
  default_route: unknown | null;
}
