import { useState, useCallback } from 'react';
import { configureClaudeCode } from '../../lib/tauri-api';
import { useSettingsStore } from '../../store/settings-store';
import { toast } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeAppInfo {
  nodeId: string;
  label: string;
  /** The port this application listens on. */
  listenPort: number;
}

interface ClaudeCodeDialogProps {
  /** List of Claude Code application nodes detected in the DAG. */
  apps: ClaudeCodeAppInfo[];
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
  width: 520,
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
  background: '#3b82f6',
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

export default function ClaudeCodeDialog({ apps, proxyUrl, onClose }: ClaudeCodeDialogProps) {
  const [configuring, setConfiguring] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const handleConfigure = useCallback(async () => {
    if (configuring) return;
    setConfiguring(true);

    try {
      const baseUrl = proxyUrl.replace(/\/$/, '');
      await configureClaudeCode(baseUrl);
      setConfigured(true);
      toast.success('Claude Code 配置已写入');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`配置失败: ${msg}`);
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

  // Build the settings.json content to display
  const settingsJson = JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: displayProxyUrl,
        ANTHROPIC_AUTH_TOKEN: tokenVisible ? authToken : maskedToken,
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
      },
    },
    null,
    2,
  );

  const onboardingJson = JSON.stringify(
    { hasCompletedOnboarding: true },
    null,
    2,
  );

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle}>
        <div style={titleStyle}>🤖 Claude Code 代理配置</div>
        <div style={subtitleStyle}>
          检测到 {apps.length} 个 Claude Code 应用节点。发布后需要将本地代理 URL 和认证令牌写入 Claude Code 配置文件，
          使其通过 AAStation 代理转发请求。认证令牌仅用于代理验证，不会转发到上游 API；上游 API Key 由 Provider 节点提供。
        </div>

        {apps.map((app) => (
          <div key={app.nodeId} style={cardStyle}>
            <div style={checkStyle}>
              <span style={{ fontWeight: 600, color: '#f9fafb' }}>🤖 {app.label}</span>
            </div>

            <div style={checkStyle}>
              <span>代理地址：</span>
              <code style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 12 }}>
                {`http://127.0.0.1:${app.listenPort}`}
              </code>
            </div>
          </div>
        ))}

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            ~/.claude/settings.json
          </div>
          <div style={codeBlockStyle}>{settingsJson}</div>

          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
            ~/.claude.json
          </div>
          <div style={codeBlockStyle}>{onboardingJson}</div>
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
