import { useEffect } from 'react';
import TitleBar from './TitleBar';
import Header from './Header';
import StatusBar from './StatusBar';
import SidebarNav from './SidebarNav';
import HomeSubNav from './HomeSubNav';
import ToastContainer from '../common/ToastContainer';
import SettingsPage from '../pages/SettingsPage';
import MonitorPage from '../pages/MonitorPage';
import { useProxyStatus } from '../../hooks/useProxyStatus';
import { useAppStore } from '../../store/app-store';
import { useNavStore } from '../../store/nav-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
};

const mainAreaStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
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
  const activeTab = useNavStore((s) => s.activeTab);

  // Sync polled status to app store
  useEffect(() => {
    setProxyStatus(status);
  }, [status, setProxyStatus]);

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <>
            <HomeSubNav />
            <div style={canvasAreaStyle}>{children}</div>
          </>
        );
      case 'monitor':
        return <MonitorPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return null;
    }
  };

  return (
    <div style={layoutStyle}>
      <SidebarNav />
      <div style={mainAreaStyle}>
        <TitleBar />
        <Header />
        {renderContent()}
        <StatusBar />
        <ToastContainer />
      </div>
    </div>
  );
}
