import { useEffect } from 'react';
import Header from './Header';
import StatusBar from './StatusBar';
import ToastContainer from '../common/ToastContainer';
import { useProxyStatus } from '../../hooks/useProxyStatus';
import { useAppStore } from '../../store/app-store';

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
  const { status } = useProxyStatus();
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);

  // Sync polled status to app store
  useEffect(() => {
    setProxyStatus(status);
  }, [status, setProxyStatus]);

  return (
    <div style={layoutStyle}>
      <Header />
      <div style={canvasAreaStyle}>{children}</div>
      <StatusBar />
      <ToastContainer />
    </div>
  );
}
