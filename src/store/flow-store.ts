import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from 'reactflow';
import type {
  AAStationNode,
  AAStationEdge,
  AAStationNodeData,
  ListenerNodeData,
  RouterNodeData,
  ForwardNodeData,
  NodeType,
} from '../types';
import type { DAGDocument } from '../types/dag';

// ---------------------------------------------------------------------------
// Default node data factories
// ---------------------------------------------------------------------------

export function defaultListenerData(): ListenerNodeData {
  return {
    nodeType: 'listener',
    label: 'Listener',
    port: 9527,
    bindAddress: '127.0.0.1',
  };
}

export function defaultRouterData(): RouterNodeData {
  return {
    nodeType: 'router',
    label: 'Router',
    rules: [],
    defaultEdgeId: null,
  };
}

export function defaultForwardData(): ForwardNodeData {
  return {
    nodeType: 'forward',
    label: 'Forward',
    upstreamUrl: '',
    apiKey: '',
  };
}

const DEFAULT_DATA_MAP: Record<NodeType, () => AAStationNodeData> = {
  listener: defaultListenerData,
  router: defaultRouterData,
  forward: defaultForwardData,
};

// ---------------------------------------------------------------------------
// Counter for generating IDs (simple incrementing; UUID not needed for local)
// ---------------------------------------------------------------------------

let _nextId = 1;
function nextNodeId(): string {
  return `node-${Date.now()}-${_nextId++}`;
}

// ---------------------------------------------------------------------------
// Store definition
// ---------------------------------------------------------------------------

interface FlowState {
  nodes: AAStationNode[];
  edges: AAStationEdge[];

  // React Flow callbacks
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // CRUD
  addNode: (type: NodeType, position?: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, data: Partial<AAStationNodeData>) => void;
  deleteNode: (nodeId: string) => void;

  // Document-level
  loadDocument: (doc: DAGDocument) => void;
  getDocument: (name?: string) => DAGDocument;

  // Direct setters (used by loadDocument)
  setNodes: (nodes: AAStationNode[]) => void;
  setEdges: (edges: AAStationEdge[]) => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],

  // -----------------------------------------------------------------------
  // React Flow change handlers
  // -----------------------------------------------------------------------

  onNodesChange: (changes: NodeChange[]) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    set({ edges: addEdge(connection, get().edges) });
  },

  // -----------------------------------------------------------------------
  // CRUD operations
  // -----------------------------------------------------------------------

  addNode: (type: NodeType, position?: { x: number; y: number }) => {
    const id = nextNodeId();
    const data = DEFAULT_DATA_MAP[type]();
    const node: AAStationNode = {
      id,
      type, // maps to React Flow nodeTypes key
      position: position ?? { x: Math.random() * 400, y: Math.random() * 400 },
      data,
    };
    set({ nodes: [...get().nodes, node] });
    return id;
  },

  updateNodeData: (nodeId: string, patch: Partial<AAStationNodeData>) => {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== nodeId) return n;
        // Preserve the discriminated union by spreading at the Node level
        // and re-assigning data as the merged result.
        const merged = { ...n.data, ...patch } as AAStationNodeData;
        return { ...n, data: merged };
      }),
    });
  },

  deleteNode: (nodeId: string) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
  },

  // -----------------------------------------------------------------------
  // Document-level operations
  // -----------------------------------------------------------------------

  loadDocument: (doc: DAGDocument) => {
    set({ nodes: doc.nodes, edges: doc.edges });
  },

  getDocument: (name?: string) => {
    const { nodes, edges } = get();
    return {
      version: 1 as const,
      id: name ? '' : '', // will be set by caller or persist layer
      name: name ?? 'Untitled',
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    };
  },

  setNodes: (nodes: AAStationNode[]) => set({ nodes }),
  setEdges: (edges: AAStationEdge[]) => set({ edges }),
}));
