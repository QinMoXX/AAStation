import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProxyStatus } from "../types/proxy";

const POLL_INTERVAL_MS = 2000;

const DEFAULT_STATUS: ProxyStatus = {
  running: false,
  port: 0,
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
      const s = await invoke<ProxyStatus>("get_proxy_status");
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

  const startProxy = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("start_proxy");
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const stopProxy = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("stop_proxy");
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { status, loading, error, startProxy, stopProxy, refresh };
}
