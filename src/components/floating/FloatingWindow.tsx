import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import type { ProxyMessageEvent } from '../../types/proxy';
import { cn } from '../../lib/utils';
import ChatMessageList from './ChatMessageList';
import SpriteAvatar from './SpriteAvatar';
import { createChatMessage, type ChatMessage } from './ChatBubble';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 20;
const IDLE_W = 88;
const IDLE_H = 112;
const ACTIVE_W = 320;
const MIN_ACTIVE_H = 236;
const MAX_ACTIVE_H = 460;
/** Typewriter characters per tick at ~20 ticks/sec (50ms interval). */
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_INTERVAL_MS = 50;
const EXPIRY_CHECK_INTERVAL_MS = 500;
/** Messages stay visible for this long after content finishes displaying. */
const COMPLETE_TTL_MS = 30000;
/** Shorter TTL for messages with empty content. */
const EMPTY_CONTENT_TTL_MS = 5000;
/** How long the streaming indicator shows before timing out (SSE streams can be slow). */
const STREAMING_INDICATOR_MS = 120_000;

// ---------------------------------------------------------------------------
// FloatingWindow
// ---------------------------------------------------------------------------

export default function FloatingWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastAppliedHeightRef = useRef(0);
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveMessages = messages.some((m) => m.phase === 'active');
  const hasDoneMessages = messages.some((m) => m.phase === 'done');

  // Disable right-click context menu
  useEffect(() => {
    const handler = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  // Transparent areas pass through via CSS pointer-events-none on the root div;
  // the avatar wrapper and message list use pointer-events-auto to stay interactive.
  // Do NOT use setIgnoreCursorEvents(true) — OS-level click-through cannot be
  // overridden by CSS, so interactive areas would never receive pointer events.

  // ── Listen for proxy-message events ────────────────────────────────
  useEffect(() => {
    const unlisten = listen<ProxyMessageEvent>('proxy-message', (event) => {
      const msg = createChatMessage(event.payload);

      setMessages((prev) => {
        // If a message with the same requestId + direction already exists
        // (e.g. the initial empty SSE event), update it with the new content.
        const existingIdx = prev.findIndex(
          (m) => m.requestId === msg.requestId && m.direction === msg.direction,
        );

        if (existingIdx >= 0) {
          const existing = prev[existingIdx];
          const updated = [...prev];

          // Determine new mode: streaming → complete/error on follow-up
          let newMode = existing.mode;
          if (existing.mode === 'streaming') {
            newMode = msg.mode === 'error' ? 'error' : 'complete';
          }

          // Error messages show content immediately
          const isError = newMode === 'error' || msg.mode === 'error';

          updated[existingIdx] = {
            ...existing,
            fullContent: msg.fullContent || existing.fullContent,
            displayedContent: isError ? (msg.fullContent || existing.fullContent) : '',
            mode: newMode,
            phase: isError ? 'done' : 'active',
            createdAt: existing.createdAt,
            completedAt: isError ? Date.now() : undefined,
            statusCode: msg.statusCode ?? existing.statusCode,
            durationMs: msg.durationMs ?? existing.durationMs,
          };
          return updated;
        }

        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Typewriter animation loop ──────────────────────────────────────
  useEffect(() => {
    if (!hasActiveMessages) return;

    typewriterTimerRef.current = setInterval(() => {
      setMessages((prev) => {
        let changed = false;
        const now = Date.now();

        const next = prev.map((msg) => {
          if (msg.phase !== 'active') return msg;

          // mode='streaming': show indicator until timeout, then mark done
          if (msg.mode === 'streaming') {
            if (now - msg.createdAt > STREAMING_INDICATOR_MS) {
              changed = true;
              return { ...msg, phase: 'done' as const, completedAt: now };
            }
            return msg;
          }

          // mode='error': already done at creation time
          if (msg.mode === 'error') return msg;

          // mode='request' | 'complete': typewriter animation
          // Empty content → mark done immediately
          if (!msg.fullContent) {
            changed = true;
            return { ...msg, phase: 'done' as const, completedAt: now };
          }

          const remaining = msg.fullContent.length - msg.displayedContent.length;
          if (remaining <= 0) {
            changed = true;
            return { ...msg, phase: 'done' as const, completedAt: now };
          }

          const charsToAdd = Math.min(remaining, TYPEWRITER_CHARS_PER_TICK);
          changed = true;
          return {
            ...msg,
            displayedContent: msg.fullContent.slice(
              0,
              msg.displayedContent.length + charsToAdd,
            ),
          };
        });

        return changed ? next : prev;
      });
    }, TYPEWRITER_INTERVAL_MS);

    return () => {
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current);
        typewriterTimerRef.current = null;
      }
    };
  }, [hasActiveMessages]);

  // ── Expiry checker ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hasDoneMessages) return;

    expiryTimerRef.current = setInterval(() => {
      setMessages((prev) => {
        const now = Date.now();
        let changed = false;

        const next = prev.map((msg) => {
          // Never expire streaming messages — they are waiting for content
          // from an in-progress SSE stream. Only the follow-up event from the
          // backend (with real content) can resolve them.
          if (msg.mode === 'streaming') return msg;

          if (msg.phase === 'done' && msg.completedAt) {
            const ttl = msg.fullContent ? COMPLETE_TTL_MS : EMPTY_CONTENT_TTL_MS;
            if (now - msg.completedAt >= ttl) {
              changed = true;
              return { ...msg, phase: 'expiring' as const };
            }
          }
          return msg;
        });

        if (!changed) return prev;

        return next.filter((msg) => msg.phase !== 'expiring');
      });
    }, EXPIRY_CHECK_INTERVAL_MS);

    return () => {
      if (expiryTimerRef.current) {
        clearInterval(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [hasDoneMessages]);

  // ── Window resize via ResizeObserver ───────────────────────────────
  const hasMessages = messages.length > 0;

  // When content height changes, resize the window to fit.
  useEffect(() => {
    if (!hasMessages) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;

    const ro = new ResizeObserver((entries) => {
      // Debounce — only apply the final size after content settles
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = setTimeout(() => {
        for (const entry of entries) {
          const contentH = entry.contentRect.height;
          const targetH = Math.round(
            Math.min(Math.max(contentH + 56, MIN_ACTIVE_H), MAX_ACTIVE_H),
          );

          if (Math.abs(targetH - lastAppliedHeightRef.current) >= 4) {
            lastAppliedHeightRef.current = targetH;
            getCurrentWindow()
              .setSize(new LogicalSize(ACTIVE_W, targetH))
              .catch(() => {});
          }
        }
      }, 200);
    });

    ro.observe(contentEl);
    return () => {
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      ro.disconnect();
    };
  }, [hasMessages]);

  // When messages disappear, reset to idle size.
  useEffect(() => {
    if (!hasMessages) {
      lastAppliedHeightRef.current = 0;
      getCurrentWindow()
        .setSize(new LogicalSize(IDLE_W, IDLE_H))
        .catch(() => {});
    }
  }, [hasMessages]);

  // ── Drag ───────────────────────────────────────────────────────────
  const handleDragStart = async () => {
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // ignored
    }
  };

  // ── Derive app info from latest message ────────────────────────────
  const latestMsg = messages[messages.length - 1] ?? null;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="w-screen h-screen bg-transparent overflow-hidden select-none pointer-events-none">
      <div
        ref={contentRef}
        className="flex h-full flex-col items-center justify-end gap-2 px-2 pb-5"
      >
        {hasMessages && <ChatMessageList messages={messages} />}
        <div
          className={cn(
            hasMessages ? 'shrink-0' : 'flex flex-1 items-end justify-center pb-4',
            'pointer-events-auto',
          )}
        >
          <SpriteAvatar
            appType={latestMsg?.appType ?? null}
            appLabel={latestMsg?.appLabel ?? null}
            hasMessage={hasMessages}
            onPointerDown={handleDragStart}
          />
        </div>
      </div>
    </div>
  );
}
