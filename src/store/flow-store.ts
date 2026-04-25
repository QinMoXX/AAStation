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
  ProviderNodeData,
  SwitcherNodeData,
  ApplicationNodeData,
  NodeType,
  AppType,
  ProviderPreset,
  SwitcherDefaultsMap,
  ApplicationDefaultsMap,
} from '../types';
import type { DAGDocument } from '../types/dag';
import { allocatePort } from '../lib/tauri-api';
import presets from '../data/provider-presets.json';
import switcherDefaults from '../data/switcher-defaults.json';
import applicationDefaults from '../data/application-defaults.json';

// ---------------------------------------------------------------------------
// Default node data factories
// ---------------------------------------------------------------------------

export function defaultProviderData(): ProviderNodeData {
  return {
    nodeType: 'provider',
    label: 'Provider',
    baseUrl: '',
    apiKey: '',
    models: [],
  };
}

export function defaultSwitcherData(): SwitcherNodeData {
  return {
    nodeType: 'switcher',
    label: 'Switcher',
    entries: [],
    hasDefault: false,
  };
}

export function defaultApplicationData(appType: AppType = 'listener'): ApplicationNodeData {
  const appDefault = APPLICATION_DEFAULTS[appType];
  return {
    nodeType: 'application',
    label: appDefault?.defaultNodeLabel || 'Listener',
    appType,
    listenPort: 0, // 0 = unassigned, will be auto-assigned
  };
}

const DEFAULT_DATA_MAP: Record<NodeType, () => AAStationNodeData> = {
  provider: defaultProviderData,
  switcher: defaultSwitcherData,
  application: defaultApplicationData,
};

// ---------------------------------------------------------------------------
// Preset Provider helper
// ---------------------------------------------------------------------------

export const PRESET_PROVIDERS = presets as ProviderPreset[];

/** Default Switcher entries per appType, loaded from JSON config. */
export const SWITCHER_DEFAULTS = switcherDefaults as SwitcherDefaultsMap;
/** Default Application labels/help text per appType, loaded from JSON config. */
export const APPLICATION_DEFAULTS = applicationDefaults as ApplicationDefaultsMap;

export function createPresetProviderData(preset: ProviderPreset): ProviderNodeData {
  return {
    nodeType: 'provider',
    presetId: preset.id,
    label: preset.defaultLabel,
    baseUrl: preset.baseUrl,
    anthropicBaseUrl: preset.anthropicBaseUrl,
    apiKey: '',
    models: [],
  };
}

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

  /** Persisted document ID (set on load, generated on first save). */
  documentId: string;
  /** Persisted document name. */
  documentName: string;

  // React Flow callbacks
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // CRUD
  addNode: (type: NodeType, position?: { x: number; y: number }, appType?: AppType) => string;
  /** Add a preset Provider node by preset ID. */
  addPresetProviderNode: (presetId: string, position?: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, data: Partial<AAStationNodeData>) => void;
  deleteNode: (nodeId: string) => void;

  // Document-level
  loadDocument: (doc: DAGDocument) => void;
  getDocument: () => DAGDocument;

  // Direct setters (used by loadDocument)
  setNodes: (nodes: AAStationNode[]) => void;
  setEdges: (edges: AAStationEdge[]) => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  documentId: '',
  documentName: 'Untitled Pipeline',

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
    const { nodes, edges } = get();
    const hasExistingFromSameOutput = edges.some(
      (e) =>
        e.source === connection.source &&
        (e.sourceHandle ?? null) === (connection.sourceHandle ?? null),
    );
    if (hasExistingFromSameOutput) {
      return;
    }
    const newEdges = addEdge(connection, edges);

    // Auto-populate Switcher with default entries when an Application connects to it
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);

    if (
      sourceNode?.data.nodeType === 'application' &&
      targetNode?.data.nodeType === 'switcher'
    ) {
      const appType = (sourceNode.data as ApplicationNodeData).appType;
      const defaultConfig = SWITCHER_DEFAULTS[appType];

      if (defaultConfig) {
        const switcherData = targetNode.data as SwitcherNodeData;
        const existingPatterns = new Set(switcherData.entries.map((e) => e.pattern));

        // Only add entries that don't already exist (by pattern)
        const newEntries = defaultConfig.entries
          .filter((e) => !existingPatterns.has(e.pattern))
          .map((e) => ({
            id: crypto.randomUUID(),
            label: e.label,
            matchType: e.matchType,
            pattern: e.pattern,
          }));

        if (newEntries.length > 0) {
          set({
            edges: newEdges,
            nodes: nodes.map((n) =>
              n.id === targetNode.id
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      entries: [...switcherData.entries, ...newEntries],
                    } as SwitcherNodeData,
                  }
                : n,
            ),
          });
          return;
        }
      }
    }

    set({ edges: newEdges });
  },

  // -----------------------------------------------------------------------
  // CRUD operations
  // -----------------------------------------------------------------------

  addNode: (type: NodeType, position?: { x: number; y: number }, appType?: AppType) => {
    const id = nextNodeId();
    const data = type === 'application' && appType
      ? defaultApplicationData(appType)
      : DEFAULT_DATA_MAP[type]();
    const node: AAStationNode = {
      id,
      type, // maps to React Flow nodeTypes key
      position: position ?? { x: Math.random() * 400, y: Math.random() * 400 },
      data,
    };
    set({ nodes: [...get().nodes, node] });

    // For Application nodes, auto-allocate a port from the range
    if (type === 'application') {
      // Get the document WITH the newly added node to compute used ports
      const doc = get().getDocument();
      allocatePort(doc).then((port) => {
        set({
          nodes: get().nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, listenPort: port } as ApplicationNodeData }
              : n
          ),
        });
      }).catch((err) => {
        console.warn('Failed to auto-allocate port:', err);
      });
    }

    return id;
  },

  addPresetProviderNode: (presetId: string, position?: { x: number; y: number }) => {
    const preset = PRESET_PROVIDERS.find((p) => p.id === presetId);
    if (!preset) {
      throw new Error(`Unknown preset: ${presetId}`);
    }
    const id = nextNodeId();
    const data = createPresetProviderData(preset);
    const node: AAStationNode = {
      id,
      type: 'provider',
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
        const merged = { ...n.data, ...patch } as AAStationNodeData;

        // When Provider models are updated, clean up orphaned edges
        // that reference removed model handles
        if (merged.nodeType === 'provider' && n.data.nodeType === 'provider') {
          const oldModels = (n.data as ProviderNodeData).models;
          const newModels = merged.models;
          const oldModelIds = new Set(oldModels.map((m) => `model-${m.id}`));
          const newModelIds = new Set(newModels.map((m) => `model-${m.id}`));
          const removedIds = new Set(
            [...oldModelIds].filter((id) => !newModelIds.has(id)),
          );

          if (removedIds.size > 0) {
            // Remove edges whose targetHandle is a removed model handle
            set({
              edges: get().edges.filter(
                (e) =>
                  !(e.target === nodeId && e.targetHandle && removedIds.has(e.targetHandle)),
              ),
            });
          }
        }

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
    set({
      nodes: doc.nodes,
      edges: doc.edges,
      documentId: doc.id,
      documentName: doc.name,
    });
  },

  getDocument: () => {
    const { nodes, edges, documentId, documentName } = get();
    return {
      version: 2 as const,
      id: documentId || crypto.randomUUID(),
      name: documentName,
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    };
  },

  setNodes: (nodes: AAStationNode[]) => set({ nodes }),
  setEdges: (edges: AAStationEdge[]) => set({ edges }),
}));
