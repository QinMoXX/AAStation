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
  /** Whether the upstream response is an active SSE stream (body not yet available). */
  isStreaming: boolean;
  phase: 'streaming' | 'complete' | 'expiring';
  createdAt: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Raw JSON detection — if the backend's content extraction fails and we get
// raw JSON like {"model":"...","messages":[...]}, try to pull out the last
// user message text.
// ---------------------------------------------------------------------------

function tryExtractFromRawJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const messages = parsed?.messages;
    if (!Array.isArray(messages)) return null;

    // Walk messages in reverse, skip user messages that are pure tool_result
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== 'user') continue;

      const content = msg.content;
      if (typeof content === 'string') {
        if (!content.trim()) continue;
        return content;
      }
      if (!Array.isArray(content)) continue;

      // Extract text blocks only; skip tool_result blocks
      const texts: string[] = [];
      for (const block of content) {
        if (block?.type === 'tool_result') continue;
        if (typeof block?.text === 'string') {
          texts.push(block.text);
        }
      }
      if (texts.length > 0) return texts.join(' ');
      // All blocks were tool_results — skip, continue searching earlier messages
    }

    return null;
  } catch {
    return null;
  }
}

export function createChatMessage(event: ProxyMessageEvent): ChatMessage {
  const raw = event.content_preview || '';
  // If the backend fell through to raw JSON, try to extract the user message
  const extracted = tryExtractFromRawJson(raw);
  const isStreaming = event.is_streaming === true;
  const hasContent = !!(extracted ?? raw);
  return {
    id: `${event.request_id}-${event.direction}`,
    requestId: event.request_id,
    direction: event.direction,
    model: event.model,
    fullContent: extracted ?? raw,
    displayedContent: '',
    appType: event.app_type || '',
    appLabel: event.app_label || '',
    statusCode: event.status_code,
    durationMs: event.duration_ms,
    timestamp: event.timestamp,
    isStreaming,
    // Only enter the streaming phase when there's content to animate or
    // we're waiting for SSE chunks. Empty non-streaming messages are
    // already complete — show them immediately.
    phase: (isStreaming || hasContent) ? 'streaming' : 'complete',
    createdAt: Date.now(),
    completedAt: (isStreaming || hasContent) ? undefined : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ChatBubble
// ---------------------------------------------------------------------------

interface ChatBubbleProps {
  message: ChatMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  // Incoming = request from client app into AAStation → displayed on the RIGHT
  // Outgoing = response from upstream provider → displayed on the LEFT
  const isIncoming = message.direction === 'incoming';
  const isStreaming = message.phase === 'streaming';
  const hasContent = message.displayedContent.length > 0;
  const statusText = !isIncoming && message.statusCode != null
    ? `HTTP ${message.statusCode}`
    : !isIncoming
      ? '返回响应'
      : '收到请求';
  const durationText = message.durationMs != null
    ? message.durationMs >= 1000
      ? `${(message.durationMs / 1000).toFixed(1)}s`
      : `${message.durationMs}ms`
    : null;

  return (
    <div
      className={cn(
        'flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300',
        isIncoming ? 'justify-end' : 'justify-start'
      )}
    >
      <div className={cn('flex max-w-[250px] flex-col', isIncoming ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'mb-1 flex max-w-full items-center gap-1.5 px-1 text-[10px] leading-none text-white/70',
            isIncoming ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <span className="max-w-[132px] truncate font-medium">
            {message.model || message.appLabel || 'AAStation'}
          </span>
          <span className="h-1 w-1 rounded-full bg-white/35" />
          <span
            className={cn(
              'shrink-0',
              !isIncoming && message.statusCode != null && message.statusCode >= 400 && 'text-red-300'
            )}
          >
            {statusText}
          </span>
        </div>

        <div
          className={cn(
            'relative min-w-0 max-w-full rounded-[6px] px-3 py-2 text-[12px] leading-[1.48] shadow-[0_4px_14px_rgba(0,0,0,0.18)] opacity-80',
            'text-[#101010]',
            isIncoming
              ? 'ml-5 bg-[#95ec69]'
              : 'mr-5 bg-white'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-[11px] h-2.5 w-2.5 rotate-45',
              isIncoming
                ? '-left-[4px] bg-[#95ec69]'
                : '-right-[4px] bg-white'
            )}
          />

          {message.isStreaming && !hasContent ? (
            <div className="relative flex items-center gap-1.5 text-[#606060]">
              <span>正在接收流式响应</span>
              <span className="inline-flex gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-[#7a7a7a] [animation-delay:0ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-[#7a7a7a] [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-[#7a7a7a] [animation-delay:300ms]" />
              </span>
            </div>
          ) : hasContent || message.fullContent ? (
            <div className="relative line-clamp-4 break-words">
              {message.displayedContent || message.fullContent}
              {isStreaming && hasContent && (
                <span className="ml-0.5 inline-block h-3 w-[1px] animate-pulse bg-[#101010]/60 align-[-1px]" />
              )}
            </div>
          ) : (
            <div className="relative text-[#909090]">
              {isIncoming ? '(空请求体)' : '已返回响应'}
            </div>
          )}

          {(durationText || message.requestId) && (
            <div className="relative mt-1.5 flex items-center gap-2 text-[9px] leading-none text-[#606060]">
              {durationText && <span>{durationText}</span>}
              <span className="ml-auto">{message.requestId.slice(-6)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
