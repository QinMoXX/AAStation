import { useState, useCallback } from 'react';
import { useNavStore, type NavTab } from '../../store/nav-store';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { publishDag, startProxy, stopProxy, getProxyStatus } from '../../lib/tauri-api';
import { dismissAppConfigGuide, hasApplicationNodes, shouldShowAppConfigGuide } from '../../lib/app-config-guide';
import { toast } from '../../store/toast-store';
import AppConfigGuideDialog from '../common/AppConfigGuideDialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Home, Activity, Settings, Power, Upload, Puzzle } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems: { id: NavTab; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: '主页' },
  { id: 'monitor', icon: Activity, label: '监控' },
  { id: 'plugins', icon: Puzzle, label: '插件管理' },
  { id: 'settings', icon: Settings, label: '设置' },
];

export default function SidebarNav() {
  const { activeTab, setTab } = useNavStore();
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const markPublished = useAppStore((s) => s.markPublished);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const openStopProxyDialog = useAppStore((s) => s.openStopProxyDialog);
  const getDocument = useFlowStore((s) => s.getDocument);

  const [toggling, setToggling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showAppConfigGuide, setShowAppConfigGuide] = useState(false);

  const maybeShowAppConfigGuide = useCallback(() => {
    const doc = getDocument();
    if (hasApplicationNodes(doc) && shouldShowAppConfigGuide()) {
      setShowAppConfigGuide(true);
    }
  }, [getDocument]);

  const handleToggleProxy = useCallback(async () => {
    if (toggling) return;
    if (proxyStatus.running) {
      // If already in the stopping (draining) phase, re-open the force-close dialog
      if (proxyStatus.stopping) {
        openStopProxyDialog({
          activeRequests: proxyStatus.active_requests,
          intent: 'stop',
        });
        return;
      }
      setToggling(true);
      try {
        const currentStatus = await getProxyStatus();
        setProxyStatus(currentStatus);
        if (currentStatus.active_requests > 0) {
          openStopProxyDialog({
            activeRequests: currentStatus.active_requests,
            intent: 'stop',
          });
          return;
        }

        await stopProxy();
        toast.success('代理服务已停止');
        const status = await getProxyStatus();
        setProxyStatus(status);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`切换代理服务失败：${msg}`);
        console.error('[SidebarNav] Toggle proxy failed:', err);
      } finally {
        setToggling(false);
      }
      return;
    }

    setToggling(true);
    try {
      await startProxy();
      toast.success('代理服务已启动');
      maybeShowAppConfigGuide();
      const status = await getProxyStatus();
      setProxyStatus(status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`切换代理服务失败：${msg}`);
      console.error('[SidebarNav] Toggle proxy failed:', err);
    } finally {
      setToggling(false);
    }
  }, [proxyStatus.running, toggling, setProxyStatus, openStopProxyDialog, maybeShowAppConfigGuide]);

  const handlePublish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      await publishDag(getDocument());
      if (!proxyStatus.running) {
        await startProxy();
      }
      markPublished();
      const status = await getProxyStatus();
      setProxyStatus(status);
      toast.success('发布并保存成功');
      maybeShowAppConfigGuide();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`发布或保存失败：${msg}`);
      console.error('[SidebarNav] Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  }, [publishing, proxyStatus.running, getDocument, markPublished, setProxyStatus]);

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="w-[78px] h-full flex flex-col items-center py-4 px-0 gap-2 shrink-0 border-r border-border-soft bg-sidebar-surface-strong backdrop-blur-xl">
        <div className="w-12 h-12 flex items-center justify-center mb-3 rounded-2xl border border-border bg-card/70 shadow-[var(--color-shadow-soft)]">
          <img src="/logo.svg" alt="AAStation" className="w-8 h-8" />
        </div>

        {navItems.map(({ id, icon: Icon, label }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "h-12 w-12 flex items-center justify-center rounded-[14px] border text-muted transition-all duration-200 cursor-pointer",
                  "border-border/70 bg-card/35 hover:border-border hover:bg-surface hover:text-foreground",
                  activeTab === id && "border-border bg-card text-foreground shadow-[var(--color-shadow-soft)]"
                )}
                onClick={() => setTab(id)}
              >
                <Icon size={20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}

        <div className="flex-1" />

        <div className="w-8 h-px bg-border-soft my-1.5 mx-0" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-11 w-11 flex items-center justify-center rounded-[14px] border border-border/70 bg-card/35 text-muted transition-all duration-200 cursor-pointer hover:border-border hover:bg-surface hover:text-foreground disabled:opacity-36 disabled:cursor-not-allowed"
              onClick={handlePublish}
              disabled={!isDraft || publishing}
              style={{ color: isDraft && !publishing ? 'var(--color-muted)' : 'var(--color-dim)' }}
            >
              <Upload size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{publishing ? 'Saving...' : '保存'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-11 w-11 flex items-center justify-center rounded-[14px] border border-border/70 bg-card/35 text-muted transition-all duration-200 cursor-pointer hover:border-border hover:bg-surface hover:text-foreground disabled:opacity-36 disabled:cursor-not-allowed"
              onClick={handleToggleProxy}
              disabled={toggling && !proxyStatus.stopping}
              style={{ color: proxyStatus.running ? 'var(--color-success)' : 'var(--color-muted)' }}
            >
              <Power size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggling ? '处理中...' : proxyStatus.stopping ? '等待结束...' : proxyStatus.running ? '关闭代理' : '开启代理'}</TooltipContent>
        </Tooltip>

      </nav>

      <AppConfigGuideDialog
        open={showAppConfigGuide}
        onConfirm={() => {
          dismissAppConfigGuide();
          setShowAppConfigGuide(false);
        }}
      />
    </TooltipProvider>
  );
}
