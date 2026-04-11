import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ProxyStatus {
  running: boolean;
  port: number;
  published_at: string | null;
  active_routes: number;
  total_requests: number;
  uptime_seconds: number;
}

interface CompiledRoute {
  id: string;
  match_type: "path_prefix" | "header" | "model";
  pattern: string;
  upstream_url: string;
  api_key: string;
  extra_headers: Record<string, string>;
  is_default: boolean;
}

interface RouteTable {
  listen_port: number;
  listen_address: string;
  routes: CompiledRoute[];
  default_route: CompiledRoute | null;
}

function App() {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [upstreamUrl, setUpstreamUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [pattern, setPattern] = useState("/v1");

  async function loadRoutesAndStart() {
    setError(null);
    try {
      const table: RouteTable = {
        listen_port: 9527,
        listen_address: "127.0.0.1",
        routes: [
          {
            id: "route-1",
            match_type: "path_prefix",
            pattern,
            upstream_url: upstreamUrl.replace(/\/+$/, ""),
            api_key: apiKey,
            extra_headers: {},
            is_default: false,
          },
        ],
        default_route: null,
      };
      await invoke("reload_routes", { table });
      await invoke("start_proxy");
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    }
  }

  async function stopProxy() {
    setError(null);
    try {
      await invoke("stop_proxy");
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshStatus() {
    setError(null);
    try {
      const s = await invoke<ProxyStatus>("get_proxy_status");
      setStatus(s);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <h1>AAStation Proxy</h1>

      <section className="proxy-section">
        <h2>Route Config</h2>
        <div className="form-row">
          <label>Pattern</label>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.currentTarget.value)}
            placeholder="/v1"
          />
        </div>
        <div className="form-row">
          <label>Upstream URL</label>
          <input
            value={upstreamUrl}
            onChange={(e) => setUpstreamUrl(e.currentTarget.value)}
            placeholder="https://api.openai.com"
          />
        </div>
        <div className="form-row">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            placeholder="sk-..."
          />
        </div>
      </section>

      <section className="proxy-section">
        <h2>Control</h2>
        <div className="row">
          <button onClick={loadRoutesAndStart}>Load Routes &amp; Start</button>
          <button onClick={stopProxy}>Stop</button>
          <button onClick={refreshStatus}>Refresh Status</button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {status && (
        <section className="proxy-section">
          <h2>Status</h2>
          <div className="status-grid">
            <span>Running</span>
            <span>{status.running ? "Yes" : "No"}</span>
            <span>Port</span>
            <span>{status.port || "-"}</span>
            <span>Active Routes</span>
            <span>{status.active_routes}</span>
            <span>Total Requests</span>
            <span>{status.total_requests}</span>
            <span>Uptime</span>
            <span>{status.uptime_seconds}s</span>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
