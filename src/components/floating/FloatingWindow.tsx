import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
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
const SNAP_THRESHOLD = 60;
const SNAP_GAP = 8;
/** Duration to show the streaming indicator while waiting for SSE content. */
const STREAMING_INDICATOR_MS = 5000;
/** Typewriter characters per tick at ~20 ticks/sec (50ms interval). */
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_INTERVAL_MS = 50;
const EXPIRY_CHECK_INTERVAL_MS = 500;
/** Messages stay visible for this long after content finishes displaying. */
const COMPLETE_TTL_MS = 30000;
/** Shorter TTL for messages with empty content. */
const EMPTY_CONTENT_TTL_MS = 5000;

// ---------------------------------------------------------------------------
// FloatingWindow
// ---------------------------------------------------------------------------

export default function FloatingWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draggingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastAppliedHeightRef = useRef(0);

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
  }, []);

  // ── Expiry checker ─────────────────────────────────────────────────
  useEffect(() => {
    expiryTimerRef.current = setInterval(() => {
      setMessages((prev) => {
        const now = Date.now();
        let changed = false;

        const next = prev.map((msg) => {
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
  }, []);

  // ── Window resize via ResizeObserver ───────────────────────────────
  const hasMessages = messages.length > 0;

  // When content height changes, resize the window to fit.
  useEffect(() => {
    if (!hasMessages) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const contentH = entry.contentRect.height;
        // Pad for avatar area below the message list (56px)
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
    });

    ro.observe(contentEl);
    return () => ro.disconnect();
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

  // ── Edge snapping on drag end ──────────────────────────────────────
  useEffect(() => {
    const handlePointerUp = async () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      await new Promise((r) => setTimeout(r, 300));

      try {
        const win = getCurrentWindow();
        const monitor = await win.currentMonitor();
        if (!monitor) return;

        const pos = await win.outerPosition();
        const size = await win.innerSize();
        const scale = monitor.scaleFactor;

        const wx = pos.x / scale;
        const wy = pos.y / scale;
        const sw = monitor.size.width / scale;
        const sh = monitor.size.height / scale;
        const winW = size.width / scale;
        const winH = size.height / scale;

        const distLeft = wx;
        const distRight = sw - (wx + winW);
        const distTop = wy;
        const distBottom = sh - (wy + winH);

        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        if (minDist < SNAP_THRESHOLD) {
          let newX = wx;
          let newY = wy;

          if (minDist === distLeft) newX = SNAP_GAP;
          else if (minDist === distRight) newX = sw - winW - SNAP_GAP;
          else if (minDist === distTop) newY = SNAP_GAP;
          else if (minDist === distBottom) newY = sh - winH - SNAP_GAP;

          await win.setPosition(new PhysicalPosition(newX, newY));
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error('FloatingWindow snap failed:', e);
      }
    };

    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, []);

  // ── Drag ───────────────────────────────────────────────────────────
  const handleDragStart = async () => {
    draggingRef.current = true;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      draggingRef.current = false;
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
