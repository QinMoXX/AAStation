import { useState, useCallback } from 'react';
import { configureCodexCli } from '../../lib/tauri-api';
import { useSettingsStore } from '../../store/settings-store';
import { toast } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodexCliAppInfo {
  nodeId: string;
  label: string;
  /** The port this application listens on. */
  listenPort: number;
}

interface CodexCliDialogProps {
  /** List of Codex CLI application nodes detected in the DAG. */
  apps: CodexCliAppInfo[];
  /** The proxy base URL to configure (e.g. "http://127.0.0.1:9527"). */
  proxyUrl: string;
  /** Callback when dialog is closed. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#1f2937',
  borderRadius: 12,
  padding: 24,
  width: 560,
  maxWidth: '90vw',
  maxHeight: '80vh',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  border: '1px solid #374151',
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#f9fafb',
  marginBottom: 8,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#9ca3af',
  marginBottom: 20,
  lineHeight: 1.5,
};

const cardStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const codeBlockStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #21262d',
  borderRadius: 6,
  padding: 12,
  fontSize: 12,
  fontFamily: 'monospace',
  color: '#c9d1d9',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  lineHeight: 1.6,
  marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: '#ea580c',
  color: '#fff',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #374151',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  color: '#9ca3af',
};

const btnSuccess: React.CSSProperties = {
  ...btnPrimary,
  background: '#16a34a',
};

const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: '#475569',
  cursor: 'not-allowed',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
  paddingTop: 16,
  borderTop: '1px solid #374151',
};

const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  fontSize: 13,
  color: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CodexCliDialog({ apps, proxyUrl, onClose }: CodexCliDialogProps) {
  const [configuring, setConfiguring] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const handleConfigure = useCallback(async () => {
    if (configuring) return;
    setConfiguring(true);

    try {
      const baseUrl = proxyUrl.replace(/\/$/, '');
      await configureCodexCli(baseUrl);
      setConfigured(true);
      toast.success('Codex CLI 配置写入成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 Codex CLI 配置失败：${msg}`);
    } finally {
      setConfiguring(false);
    }
  }, [proxyUrl, configuring]);

  const displayProxyUrl = proxyUrl.replace(/\/$/, '');

  // Get auth token from settings store
  const settings = useSettingsStore((s) => s.settings);
  const authToken = settings?.proxyAuthToken || '';
  const maskedToken = authToken.length > 12
    ? authToken.slice(0, 8) + '••••••••' + authToken.slice(-4)
    : '••••••••';

  // Build config.toml content to display
  const configToml = [
    `model_provider = "aastation"`,
    `model = "gpt-5.4"`,
    `model_reasoning_effort = "high"`,
    `disable_response_storage = true`,
    `preferred_auth_method = "apikey"`,
    ``,
    `[model_providers.aastation]`,
    `name = "aastation"`,
    `base_url = "${displayProxyUrl}"`,
    `wire_api = "responses"`,
  ].join('\n');

  // Build auth.json content to display
  const authJson = JSON.stringify(
    {
      OPENAI_API_KEY: tokenVisible ? authToken : maskedToken,
      auth_mode: 'apikey',
    },
    null,
    2,
  );

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle}>
        <div style={titleStyle}>⚡ Codex CLI 代理配置</div>
        <div style={subtitleStyle}>
          检测到 {apps.length} 个 Codex CLI 应用节点。发布后需要将本地代理 URL 和认证令牌写入
          Codex CLI 配置文件，使其通过 AAStation 代理转发请求。认证令牌仅用于代理验证，不会转发到上游 API；
          上游 API Key 由 Provider 节点提供。
        </div>

        {apps.map((app) => (
          <div key={app.nodeId} style={cardStyle}>
            <div style={checkStyle}>
              <span style={{ fontWeight: 600, color: '#f9fafb' }}>⚡ {app.label}</span>
            </div>

            <div style={checkStyle}>
              <span>代理地址：</span>
              <code style={{ color: '#fb923c', fontFamily: 'monospace', fontSize: 12 }}>
                {`http://127.0.0.1:${app.listenPort}`}
              </code>
            </div>
          </div>
        ))}

        <div style={cardStyle}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#9ca3af',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>将写入以下配置文件：</span>
            <button
              onClick={() => setTokenVisible(!tokenVisible)}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid #374151',
                background: 'transparent',
                color: '#9ca3af',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {tokenVisible ? '隐藏令牌' : '显示令牌'}
            </button>
          </div>

          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
            ~/.codex/config.toml
          </div>
          <div style={codeBlockStyle}>{configToml}</div>

          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
            ~/.codex/auth.json
          </div>
          <div style={codeBlockStyle}>{authJson}</div>
        </div>

        <div style={footerStyle}>
          <button style={btnSecondary} onClick={onClose}>
            稍后手动配置
          </button>
          {configured ? (
            <button style={btnSuccess} onClick={onClose}>
              ✓ 已配置完成
            </button>
          ) : (
            <button
              style={configuring ? btnDisabled : btnPrimary}
              onClick={handleConfigure}
              disabled={configuring}
            >
              {configuring ? '正在配置...' : '一键写入配置'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
