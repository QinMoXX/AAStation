import { useEffect, useRef, useCallback } from 'react';
import { useFlowStore } from '../store/flow-store';
import { useAppStore } from '../store/app-store';
import { loadDag, saveDag } from '../lib/tauri-api';
import { toast } from '../store/toast-store';
import type { DAGDocument } from '../types/dag';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay: number,
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    ((...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(...args), delay);
    }) as T,
    [delay],
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Synchronizes the Zustand flow store with the Rust backend:
 * - On mount: loads the persisted DAG via `load_dag` IPC.
 * - On change: debounced (500ms) auto-save via `save_dag` IPC.
 * - Ctrl+S: immediate save.
 */
export function useDagSync() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const loadDocument = useFlowStore((s) => s.loadDocument);
  const setDirty = useAppStore((s) => s.setDirty);
  const markDirty = useAppStore((s) => s.markDirty);

  // Track whether the initial load has completed.
  // Prevents auto-save from firing before the persisted state is restored.
  const loadDoneRef = useRef(false);

  // -----------------------------------------------------------------------
  // Build document from current store state
  // -----------------------------------------------------------------------

  const buildDoc = useCallback((): DAGDocument => {
    return useFlowStore.getState().getDocument();
  }, []);

  // -----------------------------------------------------------------------
  // Save to backend
  // -----------------------------------------------------------------------

  const saveToBackend = useCallback(
    async (doc?: DAGDocument) => {
      const document = doc ?? buildDoc();
      try {
        await saveDag(document);
        // Persist the document ID so subsequent saves use the same ID
        const store = useFlowStore.getState();
        if (!store.documentId && document.id) {
          useFlowStore.setState({ documentId: document.id });
        }
        setDirty(false);
        console.log('[useDagSync] Saved');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`保存失败：${msg}`);
        console.error('[useDagSync] Save failed:', err);
      }
    },
    [buildDoc, setDirty],
  );

  const debouncedSave = useDebouncedCallback(() => {
    if (!loadDoneRef.current) return;
    markDirty();
    saveToBackend();
  }, DEBOUNCE_MS);

  // -----------------------------------------------------------------------
  // Load on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const doc = await loadDag();
        if (cancelled) return;
        if (doc && doc.nodes && doc.nodes.length > 0) {
          loadDocument(doc);
          // Mark as draft so user can publish the loaded DAG
          markDirty();
          console.log('[useDagSync] Loaded', doc.nodes.length, 'nodes');
        } else {
          console.log('[useDagSync] No persisted DAG found, starting fresh');
        }
      } catch (err) {
        console.error('[useDagSync] Load failed:', err);
      } finally {
        if (!cancelled) {
          loadDoneRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDocument, markDirty]);

  // -----------------------------------------------------------------------
  // Debounced auto-save on node/edge changes
  // -----------------------------------------------------------------------

  useEffect(() => {
    debouncedSave();
  }, [nodes, edges, debouncedSave]);

  // -----------------------------------------------------------------------
  // Ctrl+S manual save
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveToBackend();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveToBackend]);
}
