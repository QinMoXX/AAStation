import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { ProxyMessageEvent } from '../../types/proxy';
import ChatBubble from './ChatBubble';
import SpriteAvatar from './SpriteAvatar';

const AUTO_DISMISS_MS = 4000;
const WINDOW_W = 280;
const WINDOW_H = 340;
const SNAP_THRESHOLD = 60;
const SNAP_GAP = 8;

export default function FloatingWindow() {
  const [currentMessage, setCurrentMessage] = useState<ProxyMessageEvent | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  // Listen for proxy message events
  useEffect(() => {
    const unlisten = listen<ProxyMessageEvent>('proxy-message', (event) => {
      setCurrentMessage(event.payload);

      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      dismissTimerRef.current = setTimeout(() => {
        setCurrentMessage(null);
        dismissTimerRef.current = null;
      }, AUTO_DISMISS_MS);
    });

    return () => {
      unlisten.then((fn) => fn());
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, []);

  // Edge snapping on drag end
  useEffect(() => {
    const handlePointerUp = async () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      // Debounce: wait for position to settle after drag
      await new Promise((r) => setTimeout(r, 300));

      try {
        const win = getCurrentWindow();
        const monitor = await win.currentMonitor();
        if (!monitor) return;

        const pos = await win.outerPosition();
        const scale = monitor.scaleFactor;

        // Convert physical pixels to logical
        const wx = pos.x / scale;
        const wy = pos.y / scale;
        const sw = monitor.size.width / scale;
        const sh = monitor.size.height / scale;

        const distLeft = wx;
        const distRight = sw - (wx + WINDOW_W);
        const distTop = wy;
        const distBottom = sh - (wy + WINDOW_H);

        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        if (minDist < SNAP_THRESHOLD) {
          let newX = wx;
          let newY = wy;

          if (minDist === distLeft) newX = SNAP_GAP;
          else if (minDist === distRight) newX = sw - WINDOW_W - SNAP_GAP;
          else if (minDist === distTop) newY = SNAP_GAP;
          else if (minDist === distBottom) newY = sh - WINDOW_H - SNAP_GAP;

          await win.setPosition(new PhysicalPosition(newX, newY));
        }
      } catch {
        // Silently ignore snap errors
      }
    };

    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, []);

  const hasMessage = currentMessage !== null;
  const appType = currentMessage?.app_type ?? null;
  const appLabel = currentMessage?.app_label ?? null;

  const handleDragStart = async () => {
    draggingRef.current = true;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      draggingRef.current = false;
    }
  };

  return (
    <div className="w-screen h-screen bg-transparent overflow-hidden select-none">
      <div className="flex flex-col items-center justify-end h-full pb-6 px-3 gap-3">
        <ChatBubble event={currentMessage} />
        <SpriteAvatar
          appType={appType}
          appLabel={appLabel}
          hasMessage={hasMessage}
          onPointerDown={handleDragStart}
        />
      </div>
    </div>
  );
}
