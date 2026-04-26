import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AppConfigGuideDialogProps {
  open: boolean;
  onConfirm: () => void;
}

export default function AppConfigGuideDialog({ open, onConfirm }: AppConfigGuideDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-[440px] border-border bg-card/95 shadow-[var(--color-shadow-strong)] [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>应用配置提示</DialogTitle>
          <DialogDescription className="leading-relaxed">
            检测到你正在使用应用节点。当前保存或开启代理，只会更新 AAStation 内部的代理发布状态，不会直接修改 Claude Code、
            OpenCode、Codex CLI 等应用的本地配置。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-surface/55 px-4 py-3 text-sm leading-relaxed text-muted">
          如需真正应用到本地客户端，请前往“设置 - 应用设置”执行配置写入。确认后此提示将不再弹出。
        </div>

        <DialogFooter className="border-t border-border-soft pt-4">
          <Button variant="accent" onClick={onConfirm} className="min-w-[120px]">
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
