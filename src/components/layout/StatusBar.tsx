import { useAppStore } from '../../store/app-store';
import { Separator } from '@/components/ui/separator';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export default function StatusBar() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-border-soft bg-sidebar-surface/72 px-4 text-[11px] text-muted backdrop-blur-xl">
      <div className="flex items-center gap-4">
        {proxyStatus.running && (
          <>
            <span className="rounded-full border border-border bg-card/60 px-2.5 py-1">
              端口{proxyStatus.listen_ports.length > 1 ? '组' : ''}:
              {' '}
              {proxyStatus.listen_ports.length > 0 ? proxyStatus.listen_ports.join(', ') : proxyStatus.port}
            </span>
            <Separator orientation="vertical" className="h-3 bg-border-soft" />
            <span>路由: {proxyStatus.active_routes}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        {proxyStatus.running ? (
          <>
            <span>请求: {proxyStatus.total_requests}</span>
            <Separator orientation="vertical" className="h-3 bg-border-soft" />
            <span>运行时长: {formatUptime(proxyStatus.uptime_seconds)}</span>
          </>
        ) : (
          <span className="rounded-full border border-border bg-card/60 px-2.5 py-1 text-dim">代理未启动</span>
        )}
      </div>
    </footer>
  );
}
