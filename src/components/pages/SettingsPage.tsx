import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settings-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  background: '#f8fafc',
  overflow: 'auto',
};

const containerStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: '32px auto',
  padding: '0 24px',
  width: '100%',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: '#1e293b',
  marginBottom: 24,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPort(settings.listenPort);
    setAddress(settings.listenAddress);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ listenPort: port, listenAddress: address });
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

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
