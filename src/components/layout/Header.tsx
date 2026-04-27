import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { publishDag, startProxy, stopProxy, getProxyStatus } from '../../lib/tauri-api';
import { dismissAppConfigGuide, hasApplicationNodes, shouldShowAppConfigGuide } from '../../lib/app-config-guide';
import { toast } from '../../store/toast-store';
import AppConfigGuideDialog from '../common/AppConfigGuideDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Header() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const lastPublishedAt = useAppStore((s) => s.lastPublishedAt);
  const markPublished = useAppStore((s) => s.markPublished);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const openStopProxyDialog = useAppStore((s) => s.openStopProxyDialog);
  const getDocument = useFlowStore((s) => s.getDocument);

  const [publishing, setPublishing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAppConfigGuide, setShowAppConfigGuide] = useState(false);

  const maybeShowAppConfigGuide = useCallback(() => {
    const doc = getDocument();
    if (hasApplicationNodes(doc) && shouldShowAppConfigGuide()) {
      setShowAppConfigGuide(true);
    }
  }, [getDocument]);

  const handleToggleProxy = useCallback(async () => {
    if (toggling) return;
    setError(null);

    if (proxyStatus.running) {
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
        setError(msg);
        toast.error(`切换代理服务失败：${msg}`);
        console.error('[Header] Toggle proxy failed:', err);
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
      setError(msg);
      toast.error(`切换代理服务失败：${msg}`);
      console.error('[Header] Toggle proxy failed:', err);
    } finally {
      setToggling(false);
    }
  }, [proxyStatus.running, toggling, setProxyStatus, openStopProxyDialog, maybeShowAppConfigGuide]);

  const handlePublish = async () => {
    if (publishing) return;

    setPublishing(true);
    setError(null);

    let dagPublished = false;

    try {
      await publishDag(getDocument());

      dagPublished = true;
      markPublished();

      if (!proxyStatus.running) {
        await startProxy();
      }

      const status = await getProxyStatus();
      setProxyStatus(status);

      toast.success('发布并保存成功');
      console.log('[Header] Published and started proxy on port', status.port);
      maybeShowAppConfigGuide();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (dagPublished) {
        toast.error(`代理启动失败：${msg}`);
        getProxyStatus().then(setProxyStatus).catch(() => {});
      } else {
        toast.error(`发布失败：${msg}`);
      }
      console.error('[Header] Publish failed:', err);
    } finally {
      setPublishing(false);
    }
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft bg-sidebar-surface/72 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="text-base font-bold text-foreground">AAStation</span>
        {isDraft ? (
          <Badge variant="warning">草稿</Badge>
        ) : lastPublishedAt ? (
          <Badge variant="success">
            已发布 {formatTime(lastPublishedAt)}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {error && (
          <span className="max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs text-destructive" title={error}>
            {error}
          </span>
        )}
        <Button
          variant={proxyStatus.running ? 'danger' : 'secondary'}
          size="sm"
          onClick={handleToggleProxy}
          disabled={toggling}
          className="gap-1.5"
        >
          <Circle
            className={cn(
              "w-2 h-2 fill-current",
              proxyStatus.running ? "text-green-400" : "text-muted-foreground"
            )}
          />
          {toggling ? '处理中...' : proxyStatus.running ? '关闭代理' : '开启代理'}
        </Button>
        <Button
          variant="accent"
          size="sm"
          onClick={handlePublish}
          disabled={!isDraft || publishing}
          className="gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          {publishing ? '保存中...' : '保存'}
        </Button>
      </div>

      <AppConfigGuideDialog
        open={showAppConfigGuide}
        onConfirm={() => {
          dismissAppConfigGuide();
          setShowAppConfigGuide(false);
        }}
      />
    </header>
  );
}
