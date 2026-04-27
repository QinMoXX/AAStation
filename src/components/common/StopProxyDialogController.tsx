import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { getProxyStatus, stopProxy } from '@/lib/tauri-api';
import { useAppStore, type StopProxyDialogIntent } from '@/store/app-store';
import { toast } from '@/store/toast-store';
import StopProxyConfirmDialog from './StopProxyConfirmDialog';

interface TrayStopProxyDialogPayload {
  active_requests: number;
  intent: StopProxyDialogIntent;
}

const TRAY_STOP_PROXY_DIALOG_EVENT = 'tray-stop-proxy-dialog';

export default function StopProxyDialogController() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const stopProxyDialog = useAppStore((s) => s.stopProxyDialog);
  const openStopProxyDialog = useAppStore((s) => s.openStopProxyDialog);
  const closeStopProxyDialog = useAppStore((s) => s.closeStopProxyDialog);
  const [forcing, setForcing] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      unlisten = await listen<TrayStopProxyDialogPayload>(TRAY_STOP_PROXY_DIALOG_EVENT, (event) => {
        if (disposed) return;
        openStopProxyDialog({
          activeRequests: event.payload.active_requests,
          intent: event.payload.intent,
        });
      });
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openStopProxyDialog]);

  const handleForceStop = useCallback(async () => {
    if (forcing) return;

    setForcing(true);

    try {
      const latestStatus = await getProxyStatus();
      if (latestStatus.running) {
        await stopProxy(true);
      }

      const status = latestStatus.running ? await getProxyStatus() : latestStatus;
      setProxyStatus(status);
      closeStopProxyDialog();
      if (stopProxyDialog.intent === 'quit') {
        await exit(0);
        return;
      }
      toast.success('代理服务已强制停止');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(stopProxyDialog.intent === 'quit' ? `强制关闭并退出失败：${msg}` : `强制关闭代理失败：${msg}`);
      console.error('[StopProxyDialogController] Force stop proxy failed:', err);
    } finally {
      setForcing(false);
    }
  }, [forcing, stopProxyDialog.intent, setProxyStatus, closeStopProxyDialog]);

  return (
    <StopProxyConfirmDialog
      open={stopProxyDialog.open}
      activeRequests={stopProxyDialog.activeRequests || proxyStatus.active_requests}
      forcing={forcing}
      intent={stopProxyDialog.intent}
      onOpenChange={(open) => {
        if (!forcing && !open) {
          closeStopProxyDialog();
        }
      }}
      onForceStop={handleForceStop}
    />
  );
}
