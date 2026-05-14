import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import type { ProxyMessageEvent } from '../../types/proxy';
import ChatMessageList from './ChatMessageList';
import SpriteAvatar from './SpriteAvatar';
import { createChatMessage, type ChatMessage } from './ChatBubble';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 10;
const IDLE_W = 88;
const IDLE_H = 112;
const ACTIVE_W = 320;
const SNAP_THRESHOLD = 60;
const SNAP_GAP = 8;
/** Duration to show the streaming indicator when the response body is empty (SSE). */
const STREAMING_INDICATOR_MS = 5000;
/** Typewriter characters per tick at ~20 ticks/sec (50ms interval). */
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_INTERVAL_MS = 50;
const EXPIRY_CHECK_INTERVAL_MS = 500;
/** Messages stay visible for this long after content finishes displaying. */
const COMPLETE_TTL_MS = 10000;
/** Shorter TTL for messages with empty content (SSE responses). */
const EMPTY_CONTENT_TTL_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeActiveHeight(count: number): number {
  // Keep the floating chat compact while leaving room for WeChat-style bubbles.
  const h = 126 + count * 68;
  return Math.min(Math.max(h, 236), 460);
}

// ---------------------------------------------------------------------------
// FloatingWindow
// ---------------------------------------------------------------------------

export default function FloatingWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draggingRef = useRef(false);

  // Disable right-click context menu
  useEffect(() => {
    const handler = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  // ── Listen for proxy-message events ────────────────────────────────
  useEffect(() => {
    const unlisten = listen<ProxyMessageEvent>('proxy-message', (event) => {
      const msg = createChatMessage(event.payload);
      setMessages((prev) => {
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
          if (msg.phase !== 'streaming') return msg;

          // Empty content = SSE streaming indicator. Keep showing for a bit.
          if (!msg.fullContent) {
            if (now - msg.createdAt > STREAMING_INDICATOR_MS) {
              changed = true;
              return { ...msg, phase: 'complete' as const, completedAt: now };
            }
            return msg;
          }

          // Typewriter: reveal characters progressively
          const remaining = msg.fullContent.length - msg.displayedContent.length;
          if (remaining <= 0) {
            changed = true;
            return { ...msg, phase: 'complete' as const, completedAt: now };
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
          if (msg.phase === 'complete' && msg.completedAt) {
            const ttl = msg.fullContent ? COMPLETE_TTL_MS : EMPTY_CONTENT_TTL_MS;
            if (now - msg.completedAt >= ttl) {
              changed = true;
              return { ...msg, phase: 'expiring' as const };
            }
          }
          return msg;
        });

        if (!changed) return prev;

        // Remove expired messages
        const filtered = next.filter((msg) => msg.phase !== 'expiring');
        return filtered;
      });
    }, EXPIRY_CHECK_INTERVAL_MS);

    return () => {
      if (expiryTimerRef.current) {
        clearInterval(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, []);

  // ── Window resize ──────────────────────────────────────────────────
  const hasMessages = messages.length > 0;

  useEffect(() => {
    const size = hasMessages
      ? new LogicalSize(ACTIVE_W, computeActiveHeight(messages.length))
      : new LogicalSize(IDLE_W, IDLE_H);
    getCurrentWindow().setSize(size).catch(() => {});
  }, [hasMessages, messages.length]);

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
      } catch {
        // Silently ignore snap errors
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
    <div className="w-screen h-screen bg-transparent overflow-hidden select-none">
      <div className="flex h-full flex-col items-center justify-end gap-2 px-2 pb-5">
        {hasMessages && <ChatMessageList messages={messages} />}
        <div className={hasMessages ? 'shrink-0' : 'flex flex-1 items-end justify-center pb-4'}>
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
