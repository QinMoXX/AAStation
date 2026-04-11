import Header from './Header';
import StatusBar from './StatusBar';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
};

const canvasAreaStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div style={layoutStyle}>
      <Header />
      <div style={canvasAreaStyle}>{children}</div>
      <StatusBar />
    </div>
  );
}
