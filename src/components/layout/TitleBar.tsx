import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const titleBarStyle: React.CSSProperties = {
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: '#0f172a',
  color: '#94a3b8',
  fontSize: 12,
  paddingLeft: 12,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 500,
  userSelect: 'none',
};

const windowControlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: '100%',
};

const controlBtnBase: React.CSSProperties = {
  width: 46,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: 12,
  transition: 'background 0.15s',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

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
    <div style={titleBarStyle} data-tauri-drag-region>
      <span style={titleStyle} data-tauri-drag-region>
        AAStation
      </span>
      <div style={windowControlsStyle}>
        <button
          style={controlBtnBase}
          onClick={handleMinimize}
          title="最小化"
          onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          ─
        </button>
        <button
          style={controlBtnBase}
          onClick={handleToggleMaximize}
          title={isMaximized ? '还原' : '最大化'}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {isMaximized ? '❐' : '□'}
        </button>
        <button
          style={controlBtnBase}
          onClick={handleClose}
          title="关闭"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#dc2626';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#94a3b8';
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
