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
import type { DAGDocument } from '../types/dag';
import type { ProxyStatus, RouteTableSet } from '../types/proxy';
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

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

/** Load application settings from disk. Returns defaults if no file exists. */
export async function loadSettings(): Promise<AppSettings> {
  const raw = await invoke<{ listen_port_range: string; listen_address: string; proxy_auth_token: string }>('load_settings');
  return {
    listenPortRange: raw.listen_port_range,
    listenAddress: raw.listen_address,
    proxyAuthToken: raw.proxy_auth_token,
  };
}

/** Save application settings to disk. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_settings', {
    settings: {
      listen_port_range: settings.listenPortRange,
      listen_address: settings.listenAddress,
      proxy_auth_token: settings.proxyAuthToken,
    },
  });
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
