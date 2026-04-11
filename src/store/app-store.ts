import { create } from 'zustand';
import type { ProxyStatus } from '../types/proxy';

// ---------------------------------------------------------------------------
// App-level state that is NOT part of the canvas graph.
// ---------------------------------------------------------------------------

interface AppState {
  /** Current proxy server status. */
  proxyStatus: ProxyStatus;

  /** Whether the canvas has unsaved changes since last save/publish. */
  isDirty: boolean;

  /** ID of the currently selected node (null = none selected). */
  selectedNodeId: string | null;

  /** Whether the canvas state differs from the last published state. */
  isDraft: boolean;

  /** Timestamp (ISO 8601) of last successful publish, if any. */
  lastPublishedAt: string | null;

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  setProxyStatus: (status: ProxyStatus) => void;
  setDirty: (dirty: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  markPublished: () => void;
  markDirty: () => void;
}

const DEFAULT_PROXY_STATUS: ProxyStatus = {
  running: false,
  port: 0,
  published_at: null,
  active_routes: 0,
  total_requests: 0,
  uptime_seconds: 0,
};

export const useAppStore = create<AppState>((set) => ({
  proxyStatus: DEFAULT_PROXY_STATUS,
  isDirty: false,
  selectedNodeId: null,
  isDraft: false,
  lastPublishedAt: null,

  setProxyStatus: (status) => set({ proxyStatus: status }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  /** Call after a successful publish to clear draft state. */
  markPublished: () =>
    set({
      isDraft: false,
      isDirty: false,
      lastPublishedAt: new Date().toISOString(),
    }),

  /** Call when canvas changes relative to the published state. */
  markDirty: () =>
    set({
      isDirty: true,
      isDraft: true,
    }),
}));
