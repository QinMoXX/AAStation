import { useEffect, useState } from 'react';
import type { ProxyMessageEvent } from '../../types/proxy';
import { cn } from '../../lib/utils';

interface ChatBubbleProps {
  event: ProxyMessageEvent | null;
}

export default function ChatBubble({ event }: ChatBubbleProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState<'enter' | 'exit' | null>(null);

  useEffect(() => {
    if (!event) {
      if (animating === 'enter') {
        setAnimating('exit');
        const t = setTimeout(() => {
          setVisible(false);
          setAnimating(null);
        }, 250);
        return () => clearTimeout(t);
      }
      setVisible(false);
      setAnimating(null);
      return;
    }

    setVisible(true);
    setAnimating('enter');
    const enterTimer = setTimeout(() => setAnimating(null), 350);
    return () => clearTimeout(enterTimer);
  }, [event?.request_id]);

  if (!visible || !event) return null;

  const isIncoming = event.direction === 'incoming';

  return (
    <div
      data-tauri-drag-region="false"
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'max-w-[240px] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
        'backdrop-blur-lg border shadow-lg',
        'transition-all duration-300 ease-out',
        animating === 'enter' && 'animate-in fade-in slide-in-from-bottom-2',
        animating === 'exit' && 'animate-out fade-out slide-out-to-bottom-2',
        isIncoming
          ? 'bg-[rgba(59,130,246,0.12)] border-[rgba(59,130,246,0.32)] text-foreground ml-1'
          : 'bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.32)] text-foreground mr-1'
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          isIncoming ? 'bg-blue-400' : 'bg-emerald-400'
        )} />
        <span className="font-semibold text-[11px] text-muted">
          {isIncoming ? '收到请求' : '返回响应'}
        </span>
      </div>

      {event.model && (
        <div className="text-[11px] text-dim mb-1">
          模型：{event.model}
        </div>
      )}

      {event.content_preview && (
        <div className="text-[11px] text-foreground/80 break-words line-clamp-4">
          {event.content_preview}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-dim">
        {event.duration_ms != null && (
          <span>{event.duration_ms}ms</span>
        )}
        {event.status_code != null && (
          <span className={event.status_code < 400 ? 'text-emerald-400' : 'text-red-400'}>
            HTTP {event.status_code}
          </span>
        )}
        <span className="ml-auto">{event.request_id.slice(-6)}</span>
      </div>
    </div>
  );
}
