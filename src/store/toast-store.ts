import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, default 4000
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => string;
  remove: (id: string) => void;
  clear: () => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  add: (toast) => {
    const id = `toast-${++toastId}`;
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    return id;
  },

  remove: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clear: () => {
    set({ toasts: [] });
  },
}));

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export const toast = {
  success: (message: string, duration = 4000) =>
    useToastStore.getState().add({ type: 'success', message, duration }),

  error: (message: string, duration = 6000) =>
    useToastStore.getState().add({ type: 'error', message, duration }),

  info: (message: string, duration = 4000) =>
    useToastStore.getState().add({ type: 'info', message, duration }),

  warning: (message: string, duration = 5000) =>
    useToastStore.getState().add({ type: 'warning', message, duration }),
};
