import { Suspense, lazy, useEffect, Component, type ReactNode } from 'react';
import TitleBar from './TitleBar';
import SidebarNav from './SidebarNav';
import HomeSubNav from './HomeSubNav';
import StopProxyDialogController from '../common/StopProxyDialogController';
import ToastContainer from '../common/ToastContainer';
import { useProxyStatus } from '../../hooks/useProxyStatus';
import { useAppStore } from '../../store/app-store';
import { useNavStore } from '../../store/nav-store';

class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center w-full h-full bg-background p-8">
            <div className="max-w-lg text-center">
              <h2 className="text-lg font-bold text-red-400 mb-2">页面渲染出错</h2>
              <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-all text-left bg-surface/60 rounded-xl p-4 border border-red-500/20">
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const MonitorPage = lazy(() => import('../pages/MonitorPage'));
const AgentPluginsPage = lazy(() => import('../pages/AgentPluginsPage'));

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { status } = useProxyStatus();
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const activeTab = useNavStore((s) => s.activeTab);

  useEffect(() => {
    setProxyStatus(status);
  }, [status, setProxyStatus]);

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <div className="flex flex-1 overflow-hidden">
            <HomeSubNav />
            <div className="flex-1 relative overflow-hidden">{children}</div>
          </div>
        );
      case 'monitor':
        return (
          <Suspense fallback={<div className="flex items-center justify-center w-full h-full text-muted bg-background/80">页面加载中...</div>}>
            <MonitorPage />
          </Suspense>
        );
      case 'plugins':
        return (
          <Suspense fallback={<div className="flex items-center justify-center w-full h-full text-muted bg-background/80">页面加载中...</div>}>
            <ErrorBoundary>
              <AgentPluginsPage />
            </ErrorBoundary>
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<div className="flex items-center justify-center w-full h-full text-muted bg-background/80">页面加载中...</div>}>
            <ErrorBoundary>
              <SettingsPage />
            </ErrorBoundary>
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex w-screen h-screen overflow-hidden relative ui-page">
      <SidebarNav />
      <div className="flex-1 flex flex-col overflow-hidden relative bg-background/24">
        <div
          className="absolute top-0 left-0 right-0 h-8 z-[100]"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          data-tauri-drag-region
        />
        {renderContent()}
      </div>
      <TitleBar />
      <StopProxyDialogController />
      <ToastContainer />
    </div>
  );
}
