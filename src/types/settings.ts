/** Application settings persisted to ~/.aastation/settings.json. */
export interface AppSettings {
  /** Port range for proxy listeners (e.g. "9527-9537" or "9527" for a single port). */
  listenPortRange: string;
  /** Address the proxy binds to. */
  listenAddress: string;
  /** Unique auth token for proxy access verification. Generated on first run, read-only in UI. */
  proxyAuthToken: string;
}
