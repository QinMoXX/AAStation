import { useEffect } from 'react';
import { useToastStore, type ToastType } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 44, // above status bar
  right: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 9999,
  maxWidth: 360,
};

const toastBase: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  animation: 'slideIn 0.2s ease-out',
};

const typeStyles: Record<ToastType, React.CSSProperties> = {
  success: {
    background: '#166534',
    color: '#fff',
    borderLeft: '4px solid #22c55e',
  },
  error: {
    background: '#7f1d1d',
    color: '#fff',
    borderLeft: '4px solid #ef4444',
  },
  info: {
    background: '#1e3a5f',
    color: '#fff',
    borderLeft: '4px solid #3b82f6',
  },
  warning: {
    background: '#78350f',
    color: '#fff',
    borderLeft: '4px solid #f59e0b',
  },
};

const iconStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.4,
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  opacity: 0.7,
  cursor: 'pointer',
  padding: 0,
  fontSize: 16,
  lineHeight: 1,
  marginLeft: 'auto',
  flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ToastItem({ id, type, message, duration = 4000 }: {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}) {
  const remove = useToastStore((s) => s.remove);

  useEffect(() => {
    const timer = setTimeout(() => remove(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, remove]);

  return (
    <div style={{ ...toastBase, ...typeStyles[type] }}>
      <span style={iconStyle}>{icons[type]}</span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
      <button style={closeBtnStyle} onClick={() => remove(id)}>×</button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div style={containerStyle}>
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
