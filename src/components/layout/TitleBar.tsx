import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const checkMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();
    const unlisten = appWindow.onResized(() => checkMaximized());
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleToggleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  const dotColor = (id: string, color: string) =>
    hovered === id ? color : '#64748b';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed top-3 right-3 flex items-center gap-2 z-[9999] px-2.5 py-2 rounded-full border border-border bg-card/72 shadow-[var(--color-shadow-soft)] backdrop-blur-xl">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="w-3.5 h-3.5 rounded-full border border-white/10 transition-all duration-200 hover:scale-105 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.05)] cursor-pointer"
              style={{ background: dotColor('min', '#fbbf24') }}
              onClick={handleMinimize}
              onMouseEnter={() => setHovered('min')}
              onMouseLeave={() => setHovered(null)}
            />
          </TooltipTrigger>
          <TooltipContent>最小化</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="w-3.5 h-3.5 rounded-full border border-white/10 transition-all duration-200 hover:scale-105 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.05)] cursor-pointer"
              style={{ background: dotColor('max', '#22c55e') }}
              onClick={handleToggleMaximize}
              onMouseEnter={() => setHovered('max')}
              onMouseLeave={() => setHovered(null)}
            />
          </TooltipTrigger>
          <TooltipContent>{isMaximized ? '还原' : '最大化'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="w-3.5 h-3.5 rounded-full border border-white/10 transition-all duration-200 hover:scale-105 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.05)] cursor-pointer"
              style={{ background: dotColor('close', '#ef4444') }}
              onClick={handleClose}
              onMouseEnter={() => setHovered('close')}
              onMouseLeave={() => setHovered(null)}
            />
          </TooltipTrigger>
          <TooltipContent>关闭</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
