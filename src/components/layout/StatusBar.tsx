import { useAppStore } from '../../store/app-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const barStyle: React.CSSProperties = {
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: '#1a1a1a',
  color: '#9ca3af',
  fontSize: 11,
  borderTop: '1px solid #2b2b2b',
  flexShrink: 0,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StatusBar() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);

  return (
    <footer style={barStyle}>
      <div style={sectionStyle}>
        {proxyStatus.running && (
          <>
            <span>Port: {proxyStatus.port}</span>
            <span>Routes: {proxyStatus.active_routes}</span>
          </>
        )}
      </div>
      <div style={sectionStyle}>
        {proxyStatus.running && (
          <>
            <span>Requests: {proxyStatus.total_requests}</span>
            <span>Uptime: {formatUptime(proxyStatus.uptime_seconds)}</span>
          </>
        )}
        {!proxyStatus.running && (
          <span style={{ color: '#6b7280' }}>Proxy offline</span>
        )}
      </div>
    </footer>
  );
}
