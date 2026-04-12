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
import type { ProxyStatus, RouteTable } from '../types/proxy';
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
 * Returns the compiled RouteTable on success; throws on validation/compile error.
 */
export async function publishDag(doc: DAGDocument): Promise<RouteTable> {
  const backendDoc = toBackendDocument(doc);
  return invoke<RouteTable>('publish_dag', { doc: backendDoc });
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
  const raw = await invoke<{ listen_port: number; listen_address: string }>('load_settings');
  return {
    listenPort: raw.listen_port,
    listenAddress: raw.listen_address,
  };
}

/** Save application settings to disk. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_settings', {
    settings: {
      listen_port: settings.listenPort,
      listen_address: settings.listenAddress,
    },
  });
}
