import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { useSettingsStore } from '../../store/settings-store';
import { publishDag, startProxy, stopProxy, getProxyStatus } from '../../lib/tauri-api';
import { toast } from '../../store/toast-store';
import SettingsModal from '../settings/SettingsModal';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headerStyle: React.CSSProperties = {
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: '#1e293b',
  color: '#f1f5f9',
  fontSize: 14,
  fontWeight: 600,
  borderBottom: '1px solid #334155',
  flexShrink: 0,
};

const leftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const statusDotStyle = (running: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: running ? '#22c55e' : '#94a3b8',
  boxShadow: running ? '0 0 6px #22c55e80' : 'none',
});

const badgeBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
};

const draftBadge: React.CSSProperties = {
  ...badgeBase,
  background: '#fbbf2430',
  color: '#fbbf24',
  border: '1px solid #fbbf2450',
};

const publishedBadge: React.CSSProperties = {
  ...badgeBase,
  background: '#22c55e25',
  color: '#22c55e',
  border: '1px solid #22c55e40',
};

const rightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const publishBtn: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: '#3b82f6',
  color: '#fff',
};

const publishBtnDisabled: React.CSSProperties = {
  ...publishBtn,
  background: '#475569',
  cursor: 'not-allowed',
};

const settingsBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 14,
  border: '1px solid #475569',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  color: '#94a3b8',
  lineHeight: 1,
};

const toggleBtnBase: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  transition: 'background 0.15s',
};

const toggleBtnOn: React.CSSProperties = {
  ...toggleBtnBase,
  background: '#166534',
  color: '#fff',
};

const toggleBtnOff: React.CSSProperties = {
  ...toggleBtnBase,
  background: '#374151',
  color: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Header() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const lastPublishedAt = useAppStore((s) => s.lastPublishedAt);
  const markPublished = useAppStore((s) => s.markPublished);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const getDocument = useFlowStore((s) => s.getDocument);
  const settings = useSettingsStore((s) => s.settings);

  const [publishing, setPublishing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // -----------------------------------------------------------------------
  // Toggle proxy on/off (independent of publish)
  // -----------------------------------------------------------------------

  const handleToggleProxy = useCallback(async () => {
    if (toggling) return;

    setToggling(true);
    setError(null);

    try {
      if (proxyStatus.running) {
        await stopProxy();
        toast.success('Proxy server stopped');
      } else {
        await startProxy();
        toast.success('Proxy server started');
      }
      const status = await getProxyStatus();
      setProxyStatus(status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Failed to toggle proxy: ${msg}`);
      console.error('[Header] Toggle proxy failed:', err);
    } finally {
      setToggling(false);
    }
  }, [proxyStatus.running, toggling, setProxyStatus]);

  const handlePublish = async () => {
    if (publishing) return;

    setPublishing(true);
    setError(null);

    try {
      // 1. Publish DAG (validate → compile → hot-load routes)
      const doc = getDocument();
      await publishDag(doc);

      // 2. Start proxy server (if not already running)
      if (!proxyStatus.running) {
        await startProxy();
      }

      // 3. Update UI state
      markPublished();
      const status = await getProxyStatus();
      setProxyStatus(status);

      toast.success('Published successfully');
      console.log('[Header] Published and started proxy on port', status.port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Publish failed: ${msg}`);
      console.error('[Header] Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return null;
    }
  };

  return (
    <>
      <header style={headerStyle}>
        <div style={leftStyle}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>AAStation</span>
          {isDraft ? (
            <span style={draftBadge}>Draft</span>
          ) : lastPublishedAt ? (
            <span style={publishedBadge}>
              Published {formatTime(lastPublishedAt)}
            </span>
          ) : null}
        </div>
        <div style={rightStyle}>
          {error && (
            <span
              style={{
                fontSize: 11,
                color: '#f87171',
                maxWidth: 300,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={error}
            >
              {error}
            </span>
          )}
          <button
            style={proxyStatus.running ? toggleBtnOn : toggleBtnOff}
            onClick={handleToggleProxy}
            disabled={toggling}
            title={proxyStatus.running ? 'Stop proxy server' : 'Start proxy server'}
          >
            <span style={statusDotStyle(proxyStatus.running)} />
            {toggling ? '...' : proxyStatus.running ? 'Running' : 'Stopped'}
          </button>
          <button
            style={settingsBtnStyle}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙
          </button>
          <button
            style={publishing ? publishBtnDisabled : isDraft ? publishBtn : publishBtnDisabled}
            onClick={handlePublish}
            disabled={!isDraft || publishing}
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
