import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settings-store';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState(settings.listenPort);
  const [address, setAddress] = useState(settings.listenAddress);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPort(settings.listenPort);
    setAddress(settings.listenAddress);
  }, [settings, open]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ listenPort: port, listenAddress: address });
      onClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          minWidth: 360,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600 }}>
          Settings
        </h2>

        {/* Listen Port */}
        <label
          style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#374151' }}
        >
          Listen Port
          <input
            type="number"
            value={port}
            min={1}
            max={65535}
            onChange={(e) => setPort(Number(e.target.value))}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </label>

        {/* Bind Address */}
        <label
          style={{ display: 'block', marginBottom: 20, fontSize: 13, color: '#374151' }}
        >
          Bind Address
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: saving ? '#93c5fd' : '#3b82f6',
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
