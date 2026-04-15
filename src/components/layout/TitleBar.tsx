import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 9999,
};

const btnStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
    <div style={containerStyle}>
      <button
        style={{
          ...btnStyle,
          background: hovered === 'min' ? '#fbbf24' : '#6b7280',
        }}
        onClick={handleMinimize}
        title="最小化"
        onMouseEnter={() => setHovered('min')}
        onMouseLeave={() => setHovered(null)}
      />
      <button
        style={{
          ...btnStyle,
          background: hovered === 'max' ? '#22c55e' : '#6b7280',
        }}
        onClick={handleToggleMaximize}
        title={isMaximized ? '还原' : '最大化'}
        onMouseEnter={() => setHovered('max')}
        onMouseLeave={() => setHovered(null)}
      />
      <button
        style={{
          ...btnStyle,
          background: hovered === 'close' ? '#dc2626' : '#6b7280',
        }}
        onClick={handleClose}
        title="关闭"
        onMouseEnter={() => setHovered('close')}
        onMouseLeave={() => setHovered(null)}
      />
    </div>
  );
}
