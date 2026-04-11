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
import type { ProxyStatus } from '../types/proxy';
import type { PublishResult } from '../types/proxy';
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
 * Returns a PublishResult indicating success/failure.
 */
export async function publishDag(doc: DAGDocument): Promise<PublishResult> {
  const backendDoc = toBackendDocument(doc);
  return invoke<PublishResult>('publish_dag', { doc: backendDoc });
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
