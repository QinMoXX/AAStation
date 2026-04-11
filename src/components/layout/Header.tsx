import { useAppStore } from '../../store/app-store';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Header() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const lastPublishedAt = useAppStore((s) => s.lastPublishedAt);

  const handlePublish = () => {
    // Will be wired to Tauri IPC in Phase 4
    console.log('Publish clicked — to be implemented in Phase 4');
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
    <header style={headerStyle}>
      <div style={leftStyle}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>AAStation</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={statusDotStyle(proxyStatus.running)} />
          <span style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>
            {proxyStatus.running ? `Running :${proxyStatus.port}` : 'Stopped'}
          </span>
        </div>
        {isDraft ? (
          <span style={draftBadge}>Draft</span>
        ) : lastPublishedAt ? (
          <span style={publishedBadge}>
            Published {formatTime(lastPublishedAt)}
          </span>
        ) : null}
      </div>
      <div style={rightStyle}>
        <button
          style={isDraft ? publishBtn : publishBtnDisabled}
          onClick={handlePublish}
          disabled={!isDraft}
        >
          Publish
        </button>
      </div>
    </header>
  );
}
