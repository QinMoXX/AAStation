import { useState, useEffect, useCallback } from 'react';
import { startProxy, stopProxy, getProxyStatus } from '../lib/tauri-api';
import type { ProxyStatus } from '../types/proxy';

const POLL_INTERVAL_MS = 2000;

const DEFAULT_STATUS: ProxyStatus = {
  running: false,
  port: 0,
  listen_ports: [],
  published_at: null,
  active_routes: 0,
  active_requests: 0,
  total_requests: 0,
  uptime_seconds: 0,
};

/**
 * Hook that polls proxy status every 2 seconds and exposes
 * start/stop actions.
 */
export function useProxyStatus() {
  const [status, setStatus] = useState<ProxyStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll on mount. The `cancelled` flag prevents state updates after
  // unmount: if the component is torn down while getProxyStatus() is still
  // awaiting, we skip the setState call to avoid updating a stale closure
  // and leaking a reference to the unmounted component's Fiber.
  useEffect(() => {
    let cancelled = false;

    const safeRefresh = async () => {
      try {
        const s = await getProxyStatus();
        if (!cancelled) {
          setStatus(s);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };

    safeRefresh();
    const id = setInterval(safeRefresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []); // intentionally empty — safeRefresh is defined inside the effect

  const start = useCallback(async () => {
    setLoading(true);
    try {
      await startProxy();
      const s = await getProxyStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setLoading(true);
    try {
      await stopProxy();
      const s = await getProxyStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Expose an imperative refresh for callers that need an on-demand update
  // (e.g. after a publish action). This one is not cancel-guarded because it
  // is expected to be called while the component is still mounted.
  const refresh = useCallback(async () => {
    try {
      const s = await getProxyStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { status, loading, error, start, stop, refresh };
}
