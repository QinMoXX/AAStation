import { Suspense, lazy, useEffect } from 'react';
import TitleBar from './TitleBar';
import SidebarNav from './SidebarNav';
import HomeSubNav from './HomeSubNav';
import ToastContainer from '../common/ToastContainer';
import { useProxyStatus } from '../../hooks/useProxyStatus';
import { useAppStore } from '../../store/app-store';
import { useNavStore } from '../../store/nav-store';

const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const MonitorPage = lazy(() => import('../pages/MonitorPage'));

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
  position: 'relative',
};

const mainAreaStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  position: 'relative',
};

const dragRegionStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 32,
  zIndex: 100,
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

const contentRowStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
};

const canvasAreaStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
};

const pageFallbackStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#94a3b8',
  background: '#111827',
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
  const activeTab = useNavStore((s) => s.activeTab);

  // Sync polled status to app store
  useEffect(() => {
    setProxyStatus(status);
  }, [status, setProxyStatus]);

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <div style={contentRowStyle}>
            <HomeSubNav />
            <div style={canvasAreaStyle}>{children}</div>
          </div>
        );
      case 'monitor':
        return (
          <Suspense fallback={<div style={pageFallbackStyle}>页面加载中...</div>}>
            <MonitorPage />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<div style={pageFallbackStyle}>页面加载中...</div>}>
            <SettingsPage />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div style={layoutStyle}>
      <SidebarNav />
      <div style={mainAreaStyle}>
        <div style={dragRegionStyle} data-tauri-drag-region />
        {renderContent()}
      </div>
      <TitleBar />
      <ToastContainer />
    </div>
  );
}
