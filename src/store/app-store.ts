import { create } from 'zustand';
import type { ProxyStatus } from '../types/proxy';

// ---------------------------------------------------------------------------
// App-level state that is NOT part of the canvas graph.
// ---------------------------------------------------------------------------

interface AvailableUpdate {
  currentVersion: string;
  latestVersion: string;
  notes?: string;
}

export type StopProxyDialogIntent = 'stop' | 'quit';

interface StopProxyDialogState {
  open: boolean;
  activeRequests: number;
  intent: StopProxyDialogIntent;
}

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

  /** Cached update metadata after a successful check. */
  availableUpdate: AvailableUpdate | null;

  /** Global stop-proxy confirmation dialog state. */
  stopProxyDialog: StopProxyDialogState;

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  setProxyStatus: (status: ProxyStatus) => void;
  setDirty: (dirty: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setAvailableUpdate: (update: AvailableUpdate | null) => void;
  clearAvailableUpdate: () => void;
  openStopProxyDialog: (payload: { activeRequests: number; intent?: StopProxyDialogIntent }) => void;
  closeStopProxyDialog: () => void;
  markPublished: () => void;
  markDirty: () => void;
}

const DEFAULT_PROXY_STATUS: ProxyStatus = {
  running: false,
  stopping: false,
  port: 0,
  listen_ports: [],
  published_at: null,
  active_routes: 0,
  active_requests: 0,
  total_requests: 0,
  uptime_seconds: 0,
};

const DEFAULT_STOP_PROXY_DIALOG: StopProxyDialogState = {
  open: false,
  activeRequests: 0,
  intent: 'stop',
};

export const useAppStore = create<AppState>((set) => ({
  proxyStatus: DEFAULT_PROXY_STATUS,
  isDirty: false,
  selectedNodeId: null,
  isDraft: false,
  lastPublishedAt: null,
  availableUpdate: null,
  stopProxyDialog: DEFAULT_STOP_PROXY_DIALOG,

  setProxyStatus: (status) => set({ proxyStatus: status }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setAvailableUpdate: (update) => set({ availableUpdate: update }),

  clearAvailableUpdate: () => set({ availableUpdate: null }),

  openStopProxyDialog: ({ activeRequests, intent = 'stop' }) =>
    set({
      stopProxyDialog: {
        open: true,
        activeRequests,
        intent,
      },
    }),

  closeStopProxyDialog: () => set({ stopProxyDialog: DEFAULT_STOP_PROXY_DIALOG }),

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
