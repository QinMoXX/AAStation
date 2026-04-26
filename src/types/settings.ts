/** Application settings persisted to ~/.aastation/settings.json. */
export interface AppSettings {
  /** Port range for proxy listeners (e.g. "9527-9537" or "9527" for a single port). */
  listenPortRange: string;
  /** Address the proxy binds to. */
  listenAddress: string;
  /** Unique auth token for proxy access verification. Generated on first run, read-only in UI. */
  proxyAuthToken: string;
  /** Maximum total size of log files in MB. Oldest files are deleted on startup when exceeded. */
  logDirMaxMb: number;
  /** Start AAStation automatically when the operating system starts. */
  launchAtStartup: boolean;
  /** Check for updates automatically on startup. */
  autoCheckUpdate: boolean;
  /** Automatically download and install updates when available. */
  autoInstallUpdate: boolean;
}
