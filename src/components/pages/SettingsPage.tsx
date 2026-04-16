import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settings-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  background: '#111827',
  overflow: 'auto',
};

const containerStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: '32px auto',
  padding: '0 24px',
  width: '100%',
};

const cardStyle: React.CSSProperties = {
  background: '#1f2937',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  border: '1px solid #374151',
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: '#f9fafb',
  marginBottom: 24,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#d1d5db',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid #374151',
  background: '#111827',
  color: '#f9fafb',
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 24,
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { settings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState(settings.listenPort);
  const [address, setAddress] = useState(settings.listenAddress);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPort(settings.listenPort);
    setAddress(settings.listenAddress);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ listenPort: port, listenAddress: address, proxyAuthToken: settings.proxyAuthToken });
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const authToken = settings.proxyAuthToken || '(未加载)';
  const maskedToken = authToken.length > 12
    ? authToken.slice(0, 8) + '••••••••' + authToken.slice(-4)
    : '••••••••';

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={titleStyle}>代理设置</h2>

          {/* Listen Port */}
          <div style={fieldStyle}>
            <label style={labelStyle}>监听端口</label>
            <input
              type="number"
              value={port}
              min={1}
              max={65535}
              onChange={(e) => setPort(Number(e.target.value))}
              style={inputStyle}
            />
          </div>

          {/* Bind Address */}
          <div style={fieldStyle}>
            <label style={labelStyle}>绑定地址</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Proxy Auth Token (read-only) */}
          <div style={fieldStyle}>
            <label style={labelStyle}>
              代理认证令牌
              <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                只读 · 客户端通过此令牌向代理认证
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type={tokenVisible ? 'text' : 'password'}
                value={tokenVisible ? authToken : maskedToken}
                readOnly
                style={{
                  ...inputStyle,
                  flex: 1,
                  color: tokenVisible ? '#f9fafb' : '#6b7280',
                  cursor: 'default',
                  userSelect: 'all',
                }}
              />
              <button
                onClick={() => setTokenVisible(!tokenVisible)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #374151',
                  background: '#1f2937',
                  color: '#d1d5db',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tokenVisible ? '隐藏' : '显示'}
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(authToken); }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #374151',
                  background: '#1f2937',
                  color: '#d1d5db',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                复制
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={buttonContainerStyle}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                ...buttonBaseStyle,
                border: 'none',
                background: saving ? '#93c5fd' : '#3b82f6',
                color: '#fff',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
