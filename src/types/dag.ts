import type { Node, Edge } from 'reactflow';
import type { AAStationNodeData } from './nodes';

export interface AAStationEdgeData {
  label?: string;
}

export type AAStationNode = Node<AAStationNodeData>;
export type AAStationEdge = Edge<AAStationEdgeData>;

/** Complete DAG document — the persistence unit. */
export interface DAGDocument {
  /** Document schema version for future migrations. */
  version: 1;
  /** Unique document identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** React Flow node list. */
  nodes: AAStationNode[];
  /** React Flow edge list. */
  edges: AAStationEdge[];
  /** Viewport state (zoom / pan). */
  viewport?: { x: number; y: number; zoom: number };
  /** Last modification time (ISO 8601). */
  updatedAt: string;
}
