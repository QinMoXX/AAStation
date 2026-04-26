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

const dragRegionStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 32,
  zIndex: 100,
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

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
          <div className="ui-content-row">
            <HomeSubNav />
            <div className="ui-canvas-area">{children}</div>
          </div>
        );
      case 'monitor':
        return (
          <Suspense fallback={<div className="ui-loading-panel">页面加载中...</div>}>
            <MonitorPage />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<div className="ui-loading-panel">页面加载中...</div>}>
            <SettingsPage />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div className="ui-shell ui-page">
      <SidebarNav />
      <div className="ui-main">
        <div style={dragRegionStyle} data-tauri-drag-region />
        {renderContent()}
      </div>
      <TitleBar />
      <ToastContainer />
    </div>
  );
}
