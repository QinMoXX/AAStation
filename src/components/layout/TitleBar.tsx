import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

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

    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  return (
    <div className="ui-titlebar">
      <button
        type="button"
        className="ui-titlebar-dot"
        style={{ background: hovered === 'min' ? '#fbbf24' : '#64748b' }}
        onClick={handleMinimize}
        title="最小化"
        onMouseEnter={() => setHovered('min')}
        onMouseLeave={() => setHovered(null)}
      />
      <button
        type="button"
        className="ui-titlebar-dot"
        style={{ background: hovered === 'max' ? '#22c55e' : '#64748b' }}
        onClick={handleToggleMaximize}
        title={isMaximized ? '还原' : '最大化'}
        onMouseEnter={() => setHovered('max')}
        onMouseLeave={() => setHovered(null)}
      />
      <button
        type="button"
        className="ui-titlebar-dot"
        style={{ background: hovered === 'close' ? '#ef4444' : '#64748b' }}
        onClick={handleClose}
        title="关闭"
        onMouseEnter={() => setHovered('close')}
        onMouseLeave={() => setHovered(null)}
      />
    </div>
  );
}
