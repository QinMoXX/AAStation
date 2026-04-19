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

  const refresh = useCallback(async () => {
    try {
      const s = await getProxyStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Poll on mount
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      await startProxy();
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const stop = useCallback(async () => {
    setLoading(true);
    try {
      await stopProxy();
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { status, loading, error, start, stop, refresh };
}
