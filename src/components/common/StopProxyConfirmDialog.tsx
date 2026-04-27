import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { StopProxyDialogIntent } from '@/store/app-store';

interface StopProxyConfirmDialogProps {
  open: boolean;
  activeRequests: number;
  forcing: boolean;
  intent: StopProxyDialogIntent;
  onOpenChange: (open: boolean) => void;
  onForceStop: () => void;
}

export default function StopProxyConfirmDialog({
  open,
  activeRequests,
  forcing,
  intent,
  onOpenChange,
  onForceStop,
}: StopProxyConfirmDialogProps) {
  const forceLabel = intent === 'quit'
    ? (forcing ? '强制关闭并退出中...' : '强制关闭并退出')
    : (forcing ? '强制关闭中...' : '强制关闭');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] border-border bg-card/95 shadow-[var(--color-shadow-strong)]">
        <DialogHeader>
          <DialogTitle>当前有请求等待结束...</DialogTitle>
          <DialogDescription className="leading-relaxed">
            当前仍有 {activeRequests} 个请求正在通过代理处理，可能包含长连接或 SSE 流式响应。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-surface/55 px-4 py-3 text-sm leading-relaxed text-muted">
          请先关闭正在使用代理的客户端，例如 Claude Code、OpenCode、Codex CLI 或其他正在发起请求的工具，等待请求自然结束后再停止代理。
          如果立即强制关闭，正在进行中的长连接 / SSE 会被直接中断。
        </div>

        <DialogFooter className="border-t border-border-soft pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={forcing}>
            先去关闭客户端
          </Button>
          <Button variant="danger" onClick={onForceStop} disabled={forcing}>
            {forceLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
