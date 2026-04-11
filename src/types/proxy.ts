/** Runtime status of the proxy server. */
export interface ProxyStatus {
  running: boolean;
  port: number;
  published_at: string | null;
  active_routes: number;
  total_requests: number;
  uptime_seconds: number;
}

/** Result of a DAG publish operation. */
export interface PublishResult {
  success: boolean;
  routeCount: number;
  errors: string[];
}
