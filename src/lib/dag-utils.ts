/**
 * Conversion utilities between the frontend DAG model (React Flow nodes/edges)
 * and the backend Rust DAG model (DAGDocument with snake_case fields).
 *
 * The Rust backend expects:
 *   DAGNode: { id, node_type, position: { x, y }, data: serde_json::Value }
 *   DAGEdge: { id, source, target, source_handle?, target_handle?, data? }
 *
 * The React Flow frontend stores:
 *   Node: { id, type, position: { x, y }, data: { nodeType, label, ... } }
 *   Edge: { id, source, target, sourceHandle?, targetHandle?, ... }
 */

import type { DAGDocument } from '../types/dag';
import type {
  AAStationNode,
  AAStationEdge,
  AAStationNodeData,
  ProviderNodeData,
  SwitcherNodeData,
  ApplicationNodeData,
} from '../types';

// ---------------------------------------------------------------------------
// Backend JSON shapes (snake_case)
// ---------------------------------------------------------------------------

interface BackendDAGNode {
  id: string;
  node_type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface BackendDAGEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  target_handle?: string | null;
  data?: Record<string, unknown> | null;
}

interface BackendDAGDocument {
  version: number;
  id: string;
  name: string;
  nodes: BackendDAGNode[];
  edges: BackendDAGEdge[];
  viewport?: { x: number; y: number; zoom: number } | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Frontend → Backend conversion
// ---------------------------------------------------------------------------

/** Convert a camelCase string to snake_case */
function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/** Convert a snake_case string to camelCase */
function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Recursively convert object keys from camelCase to snake_case, including arrays */
function keysToSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = toSnakeCase(key);
    if (value === null || value === undefined) {
      result[newKey] = value;
    } else if (Array.isArray(value)) {
      result[newKey] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? keysToSnakeCase(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === 'object') {
      result[newKey] = keysToSnakeCase(value as Record<string, unknown>);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/** Recursively convert object keys from snake_case to camelCase, including arrays */
function keysToCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = toCamelCase(key);
    if (value === null || value === undefined) {
      result[newKey] = value;
    } else if (Array.isArray(value)) {
      result[newKey] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? keysToCamelCase(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === 'object') {
      result[newKey] = keysToCamelCase(value as Record<string, unknown>);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/** Convert frontend node data to backend format */
function nodeDataToBackend(data: AAStationNodeData): Record<string, unknown> {
  // Remove nodeType from data since it becomes node_type at the node level
  const { nodeType: _, ...rest } = data;
  // Convert remaining keys to snake_case
  return keysToSnakeCase(rest as Record<string, unknown>);
}

/** Convert a single frontend AAStationNode to backend DAGNode */
function nodeToBackend(node: AAStationNode): BackendDAGNode {
  return {
    id: node.id,
    node_type: node.data.nodeType,
    position: { x: node.position.x, y: node.position.y },
    data: nodeDataToBackend(node.data),
  };
}

/** Convert a single frontend AAStationEdge to backend DAGEdge */
function edgeToBackend(edge: AAStationEdge): BackendDAGEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_handle: edge.sourceHandle ?? null,
    target_handle: edge.targetHandle ?? null,
    data: edge.data ? { ...edge.data } : null,
  };
}

/**
 * Convert a frontend DAGDocument to the backend JSON format.
 * This is what gets sent via Tauri IPC to `save_dag`.
 */
export function toBackendDocument(doc: DAGDocument): BackendDAGDocument {
  return {
    version: doc.version,
    id: doc.id,
    name: doc.name,
    nodes: doc.nodes.map(nodeToBackend),
    edges: doc.edges.map(edgeToBackend),
    viewport: doc.viewport ?? null,
    updated_at: doc.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Backend → Frontend conversion
// ---------------------------------------------------------------------------

/** Convert backend node data to frontend format based on node_type */
function nodeDataToFrontend(
  nodeType: string,
  data: Record<string, unknown>,
): AAStationNodeData {
  const camelData = keysToCamelCase(data);

  switch (nodeType) {
    case 'provider':
      return {
        nodeType: 'provider',
        label: (camelData.label as string) || 'Provider',
        apiType: (camelData.apiType as ProviderNodeData['apiType']) || 'openai',
        baseUrl: (camelData.baseUrl as string) || '',
        anthropicBaseUrl: camelData.anthropicBaseUrl as string | undefined,
        apiKey: (camelData.apiKey as string) || '',
        models: (camelData.models as ProviderNodeData['models']) || [],
        description: camelData.description as string | undefined,
      } as ProviderNodeData;
    case 'router': // backward compatibility with older data files
    case 'switcher': {
      // Strip legacy targetModel from entries (no longer used — resolved from edge connection)
      const rawEntries = (camelData.entries as Record<string, unknown>[]) || [];
      const entries = rawEntries.map((entry) => {
        // Remove targetModel if present (legacy field)
        const { targetModel: _, ...rest } = entry as Record<string, unknown> & { targetModel?: unknown };
        return rest as unknown as SwitcherNodeData['entries'][number];
      });
      return {
        nodeType: 'switcher',
        label: (camelData.label as string) || 'Switcher',
        entries,
        hasDefault: (camelData.hasDefault as boolean) ?? false,
        description: camelData.description as string | undefined,
      } as SwitcherNodeData;
    }
    case 'application':
    case 'terminal': // backward compatibility with older data files
      return {
        nodeType: 'application',
        label: (camelData.label as string) || 'Listener',
        appType: (camelData.appType as string) || 'listener',
        description: camelData.description as string | undefined,
      } as ApplicationNodeData;
    default:
      // Fallback: return as provider with minimal defaults
      return {
        nodeType: 'provider',
        label: 'Unknown',
        apiType: 'openai',
        baseUrl: '',
        apiKey: '',
        models: [],
      };
  }
}

/** Convert a single backend DAGNode to frontend AAStationNode */
function nodeToFrontend(node: BackendDAGNode): AAStationNode {
  // Map legacy node types
  let nodeType = node.node_type;
  if (nodeType === 'terminal') nodeType = 'application';
  if (nodeType === 'router') nodeType = 'switcher';
  return {
    id: node.id,
    type: nodeType,
    position: { x: node.position.x, y: node.position.y },
    data: nodeDataToFrontend(nodeType, node.data),
  };
}

/** Convert a single backend DAGEdge to frontend AAStationEdge */
function edgeToFrontend(edge: BackendDAGEdge): AAStationEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle ?? undefined,
    targetHandle: edge.target_handle ?? undefined,
    data: (edge.data as { label?: string } | undefined) ?? undefined,
  };
}

/**
 * Convert a backend JSON document to the frontend DAGDocument format.
 * This is what comes back from `load_dag` via Tauri IPC.
 */
export function fromBackendDocument(raw: BackendDAGDocument): DAGDocument {
  return {
    version: (raw.version >= 2 ? 2 : 1) as 1 | 2,
    id: raw.id,
    name: raw.name,
    nodes: raw.nodes.map(nodeToFrontend),
    edges: raw.edges.map(edgeToFrontend),
    viewport: raw.viewport ?? undefined,
    updatedAt: raw.updated_at,
  };
}
