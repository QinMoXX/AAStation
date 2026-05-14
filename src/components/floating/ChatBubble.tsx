import type { ProxyMessageEvent } from '../../types/proxy';
import { cn } from '../../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  requestId: string;
  direction: 'incoming' | 'outgoing';
  model: string;
  fullContent: string;
  displayedContent: string;
  appType: string;
  appLabel: string;
  statusCode?: number;
  durationMs?: number;
  timestamp: number;
  phase: 'streaming' | 'complete' | 'expiring';
  createdAt: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createChatMessage(event: ProxyMessageEvent): ChatMessage {
  return {
    id: `${event.request_id}-${event.direction}`,
    requestId: event.request_id,
    direction: event.direction,
    model: event.model,
    fullContent: event.content_preview || '',
    displayedContent: '',  // typewriter will fill this in
    appType: event.app_type || '',
    appLabel: event.app_label || '',
    statusCode: event.status_code,
    durationMs: event.duration_ms,
    timestamp: event.timestamp,
    phase: 'streaming',
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ChatBubble
// ---------------------------------------------------------------------------

interface ChatBubbleProps {
  message: ChatMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isIncoming = message.direction === 'incoming';
  const isStreaming = message.phase === 'streaming';
  const hasContent = message.displayedContent.length > 0;

  return (
    <div
      className={cn(
        'flex mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300',
        isIncoming ? 'justify-start' : 'justify-end'
      )}
    >
      <div
        className={cn(
          'max-w-[220px] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
          'backdrop-blur-lg border shadow-lg',
          isIncoming
            ? 'bg-[rgba(59,130,246,0.12)] border-[rgba(59,130,246,0.28)]'
            : 'bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.28)]'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              isIncoming ? 'bg-blue-400' : 'bg-emerald-400'
            )}
          />
          <span className="font-semibold text-[11px] text-muted">
            {isIncoming ? '收到请求' : '返回响应'}
          </span>
          {message.statusCode != null && !isIncoming && (
            <span
              className={cn(
                'text-[10px] ml-auto',
                message.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'
              )}
            >
              {message.statusCode}
            </span>
          )}
        </div>

        {/* Model */}
        {message.model && (
          <div className="text-[11px] text-dim mb-1">模型：{message.model}</div>
        )}

        {/* Content */}
        {isStreaming && !hasContent ? (
          <div className="flex items-center gap-1 text-[11px] text-dim">
            <span>正在接收流式响应</span>
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-dim animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-dim animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-dim animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        ) : (
          <div className="text-[11px] text-foreground/80 break-words line-clamp-4">
            {message.displayedContent || message.fullContent}
            {isStreaming && hasContent && (
              <span className="inline-block w-[1px] h-3 bg-foreground/60 ml-0.5 animate-pulse align-[-1px]" />
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-dim">
          {message.durationMs != null && (
            <span>{message.durationMs >= 1000 ? `${(message.durationMs / 1000).toFixed(1)}s` : `${message.durationMs}ms`}</span>
          )}
          <span className="ml-auto">{message.requestId.slice(-6)}</span>
        </div>
      </div>
    </div>
  );
}
