/** Application settings persisted to ~/.aastation/settings.json. */
export interface AppSettings {
  listenPort: number;
  listenAddress: string;
  /** Unique auth token for proxy access verification. Generated on first run, read-only in UI. */
  proxyAuthToken: string;
}
