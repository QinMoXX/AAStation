// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#111827',
  color: '#9ca3af',
  fontSize: 14,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MonitorPage() {
  return (
    <div style={pageStyle}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
      <div>监控功能开发中...</div>
    </div>
  );
}
