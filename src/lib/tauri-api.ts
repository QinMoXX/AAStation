/**
 * Type-safe Tauri IPC wrappers for all AAStation commands.
 *
 * Every command matches a `#[tauri::command]` on the Rust side.
 * The function signatures enforce input/output types so callers
 * never pass raw strings or lose type information.
 *
 * Save/load automatically handle the frontend ↔ backend format
 * conversion (camelCase ↔ snake_case, React Flow node format ↔ DAGNode).
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { DAGDocument } from '../types/dag';
import type { ProxyMetricsSnapshot, ProxyStatus, RouteTableSet } from '../types/proxy';
import type { AppSettings } from '../types/settings';
import { toBackendDocument, fromBackendDocument } from './dag-utils';

// ---------------------------------------------------------------------------
// Shared types for IPC results
// ---------------------------------------------------------------------------

/** Validation error returned by the Rust backend. */
export interface ValidationError {
  kind: string;
  message: string;
}

// ---------------------------------------------------------------------------
// DAG commands
// ---------------------------------------------------------------------------

/** Load the persisted DAG document. Returns a default empty doc if none exists. */
export async function loadDag(): Promise<DAGDocument> {
  const raw = await invoke<unknown>('load_dag');
  return fromBackendDocument(raw as Parameters<typeof fromBackendDocument>[0]);
}

/** Atomically save the DAG document to disk. */
export async function saveDag(doc: DAGDocument): Promise<void> {
  const backendDoc = toBackendDocument(doc);
  return invoke<void>('save_dag', { doc: backendDoc });
}

/**
 * Validate the DAG structure without persisting.
 * Returns an array of validation errors (empty = valid).
 */
export async function validateDag(doc: DAGDocument): Promise<ValidationError[]> {
  const backendDoc = toBackendDocument(doc);
  return invoke<ValidationError[]>('validate_dag', { doc: backendDoc });
}

/**
 * Validate + compile + hot-load the DAG into the running proxy.
 * Returns the compiled RouteTableSet on success; throws on validation/compile error.
 */
export async function publishDag(doc: DAGDocument): Promise<RouteTableSet> {
  const backendDoc = toBackendDocument(doc);
  return invoke<RouteTableSet>('publish_dag', { doc: backendDoc });
}

/**
 * Allocate the next available port from the settings port range for a new Application node.
 */
export async function allocatePort(doc: DAGDocument): Promise<number> {
  const backendDoc = toBackendDocument(doc);
  return invoke<number>('allocate_port', { doc: backendDoc });
}

/** Auto-assign listen ports for application nodes with missing port values. */
export async function autoAssignPorts(doc: DAGDocument): Promise<DAGDocument> {
  const backendDoc = toBackendDocument(doc);
  const raw = await invoke<unknown>('auto_assign_ports', { doc: backendDoc });
  return fromBackendDocument(raw as Parameters<typeof fromBackendDocument>[0]);
}

// ---------------------------------------------------------------------------
// Proxy commands
// ---------------------------------------------------------------------------

/** Start the proxy server with the current route table. */
export async function startProxy(): Promise<void> {
  return invoke<void>('start_proxy');
}

/** Stop the running proxy server. */
export async function stopProxy(): Promise<void> {
  return invoke<void>('stop_proxy');
}

/** Get the current proxy server status. */
export async function getProxyStatus(): Promise<ProxyStatus> {
  return invoke<ProxyStatus>('get_proxy_status');
}

/** Get the current monitoring snapshot collected by the local proxy. */
export async function getProxyMetrics(): Promise<ProxyMetricsSnapshot> {
  return invoke<ProxyMetricsSnapshot>('get_proxy_metrics');
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

/** Load application settings from disk. Returns defaults if no file exists. */
export async function loadSettings(): Promise<AppSettings> {
  const raw = await invoke<{
    listen_port_range: string;
    listen_address: string;
    proxy_auth_token: string;
    log_dir_max_mb: number;
    launch_at_startup?: boolean;
    auto_check_update?: boolean;
    auto_install_update?: boolean;
  }>('load_settings');
  return {
    listenPortRange: raw.listen_port_range,
    listenAddress: raw.listen_address,
    proxyAuthToken: raw.proxy_auth_token,
    logDirMaxMb: raw.log_dir_max_mb ?? 500,
    launchAtStartup: raw.launch_at_startup ?? false,
    autoCheckUpdate: raw.auto_check_update ?? true,
    autoInstallUpdate: raw.auto_install_update ?? false,
  };
}

/** Save application settings to disk. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_settings', {
    settings: {
      listen_port_range: settings.listenPortRange,
      listen_address: settings.listenAddress,
      proxy_auth_token: settings.proxyAuthToken,
      log_dir_max_mb: settings.logDirMaxMb,
      launch_at_startup: settings.launchAtStartup,
      auto_check_update: settings.autoCheckUpdate,
      auto_install_update: settings.autoInstallUpdate,
    },
  });
}

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  installed: boolean;
}

let pendingAppUpdate: Awaited<ReturnType<typeof check>> | null = null;

/** Check updates from configured updater endpoints and cache the result for later install. */
export async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  const currentVersion = await getVersion();
  const update = await check();
  pendingAppUpdate = update ?? null;

  if (!update) {
    return { hasUpdate: false, currentVersion, installed: false };
  }

  return {
    hasUpdate: true,
    currentVersion,
    latestVersion: update.version,
    notes: update.body ?? '',
    installed: false,
  };
}

/**
 * Download and install the cached update. If no cached update exists, re-check once.
 * On Windows, installation exits the current app process before relaunch.
 */
export async function installAppUpdate(): Promise<AppUpdateCheckResult> {
  const currentVersion = await getVersion();
  let update = pendingAppUpdate;

  if (!update) {
    update = await check();
    pendingAppUpdate = update ?? null;
  }

  if (!update) {
    return { hasUpdate: false, currentVersion, installed: false };
  }

  const result: AppUpdateCheckResult = {
    hasUpdate: true,
    currentVersion,
    latestVersion: update.version,
    notes: update.body ?? '',
    installed: false,
  };

  await update.downloadAndInstall();
  pendingAppUpdate = null;
  result.installed = true;
  await relaunch();
  return result;
}

// ---------------------------------------------------------------------------
// Runtime log commands
// ---------------------------------------------------------------------------

export interface LogRuntimeStatus {
  backend_local_read_write: boolean;
  mode: string;
  log_dir: string;
  active_file: string | null;
  note: string;
  /** Total size of all log files in bytes. */
  dir_size_bytes: number;
  /** Maximum allowed total directory size in bytes. */
  dir_max_bytes: number;
}

export interface LogPollRequest {
  file_name?: string;
  offset?: number;
  max_bytes?: number;
}

export interface LogPollResponse {
  backend_local_read_write: boolean;
  mode: string;
  file_name: string | null;
  next_offset: number;
  rotated: boolean;
  truncated: boolean;
  lines: string[];
}

/** Returns runtime log backend mode/capability information. */
export async function getLogRuntimeStatus(): Promise<LogRuntimeStatus> {
  return invoke<LogRuntimeStatus>('get_log_runtime_status');
}

/** Incrementally poll runtime log lines from the active log file. */
export async function pollRuntimeLogs(request?: LogPollRequest): Promise<LogPollResponse> {
  return invoke<LogPollResponse>('poll_runtime_logs', { request });
}

/** Open the log directory in the system file explorer. */
export async function openLogDir(): Promise<void> {
  return invoke<void>('open_log_dir');
}

// ---------------------------------------------------------------------------
// App configuration commands
// ---------------------------------------------------------------------------

/** Configure Claude Code to use the local proxy. */
export async function configureClaudeCode(proxyUrl: string): Promise<void> {
  return invoke<void>('configure_claude_code', {
    proxyUrl,
  });
}

/** Check whether Claude Code is already configured by AAStation. */
export async function isClaudeConfigured(): Promise<boolean> {
  return invoke<boolean>('is_claude_configured');
}

/** Remove Claude Code proxy configuration. */
export async function unconfigureClaudeCode(): Promise<void> {
  return invoke<void>('unconfigure_claude_code');
}

/** Restore Claude Code configuration from backup files. */
export async function restoreClaudeConfig(): Promise<void> {
  return invoke<void>('restore_claude_config');
}

// ---------------------------------------------------------------------------
// OpenCode app configuration commands
// ---------------------------------------------------------------------------

/** Configure OpenCode to use the local proxy. */
export async function configureOpenCode(proxyUrl: string): Promise<void> {
  return invoke<void>('configure_open_code', { proxyUrl });
}

/** Check whether OpenCode is already configured by AAStation. */
export async function isOpenCodeConfigured(): Promise<boolean> {
  return invoke<boolean>('is_open_code_configured');
}

/** Remove the AAStation-managed provider.aastation entry from OpenCode config. */
export async function unconfigureOpenCode(): Promise<void> {
  return invoke<void>('unconfigure_open_code');
}

/** Restore OpenCode config from the .aastation-backup backup file. */
export async function restoreOpenCodeConfig(): Promise<void> {
  return invoke<void>('restore_open_code_config');
}

// ---------------------------------------------------------------------------
// Codex CLI app configuration commands
// ---------------------------------------------------------------------------

/** Configure Codex CLI to use the local proxy. */
export async function configureCodexCli(proxyUrl: string): Promise<void> {
  return invoke<void>('configure_codex_cli', { proxyUrl });
}

/** Check whether Codex CLI is already configured by AAStation. */
export async function isCodexCliConfigured(): Promise<boolean> {
  return invoke<boolean>('is_codex_cli_configured');
}

/** Remove the AAStation-managed entries from Codex CLI config. */
export async function unconfigureCodexCli(): Promise<void> {
  return invoke<void>('unconfigure_codex_cli');
}

/** Restore Codex CLI config from the .aastation-backup backup file. */
export async function restoreCodexCliConfig(): Promise<void> {
  return invoke<void>('restore_codex_cli_config');
}
