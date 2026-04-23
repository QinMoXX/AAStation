import { useState, useCallback } from 'react';
import { configureOpenCode } from '../../lib/tauri-api';
import { useSettingsStore } from '../../store/settings-store';
import { toast } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenCodeAppInfo {
  nodeId: string;
  label: string;
  /** The port this application listens on. */
  listenPort: number;
}

interface OpenCodeDialogProps {
  /** List of OpenCode application nodes detected in the DAG. */
  apps: OpenCodeAppInfo[];
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
  background: '#7c3aed',
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

export default function OpenCodeDialog({ apps, proxyUrl, onClose }: OpenCodeDialogProps) {
  const [configuring, setConfiguring] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const handleConfigure = useCallback(async () => {
    if (configuring) return;
    setConfiguring(true);

    try {
      const baseUrl = proxyUrl.replace(/\/$/, '');
      await configureOpenCode(baseUrl);
      setConfigured(true);
      toast.success('OpenCode 配置写入成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 OpenCode 配置失败：${msg}`);
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

  // Build the config.json content to display
  const configJson = JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        aastation: {
          npm: '@ai-sdk/anthropic',
          options: {
            baseURL: displayProxyUrl,
            apiKey: tokenVisible ? authToken : maskedToken,
          },
          models: {},
        },
      },
    },
    null,
    2,
  );

  // Config file path hint
  const configPath = navigator.platform.startsWith('Win')
    ? '%APPDATA%\\opencode\\config.json'
    : '~/.config/opencode/config.json';

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle}>
        <div style={titleStyle}>💻 OpenCode 代理配置</div>
        <div style={subtitleStyle}>
          检测到 {apps.length} 个 OpenCode 应用节点。发布后需要将本地代理 URL 和认证令牌写入 OpenCode 配置文件，
          使其通过 AAStation 代理转发请求。认证令牌仅用于代理验证，不会转发到上游 API；上游 API Key 由 Provider 节点提供。
        </div>

        {apps.map((app) => (
          <div key={app.nodeId} style={cardStyle}>
            <div style={checkStyle}>
              <span style={{ fontWeight: 600, color: '#f9fafb' }}>💻 {app.label}</span>
            </div>

            <div style={checkStyle}>
              <span>代理地址：</span>
              <code style={{ color: '#a78bfa', fontFamily: 'monospace', fontSize: 12 }}>
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
            {configPath}
          </div>
          <div style={codeBlockStyle}>{configJson}</div>
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
