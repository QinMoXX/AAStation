import { useCallback, useState, useRef, useEffect } from 'react';
import { useReactFlow } from 'reactflow';
import { useFlowStore, PRESET_PROVIDERS } from '../../store/flow-store';
import type { NodeType } from '../../types';
import { getProviderIcon, CustomProviderIcon } from '../icons/ProviderIcons';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 10,
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  whiteSpace: 'nowrap' as const,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#e2e8f0',
  margin: '0 4px',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  minWidth: 180,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 100,
  overflow: 'hidden',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: '#334155',
  cursor: 'pointer',
  borderBottom: '1px solid #f1f5f9',
};

const dropdownSectionHeaderStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 10,
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  background: '#f8fafc',
};

// ---------------------------------------------------------------------------
// Provider Dropdown Component
// ---------------------------------------------------------------------------

function ProviderDropdownButton() {
  const addNode = useFlowStore((s) => s.addNode);
  const addPresetProviderNode = useFlowStore((s) => s.addPresetProviderNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPreset = useCallback(
    (presetId: string) => {
      addPresetProviderNode(presetId);
      setIsOpen(false);
    },
    [addPresetProviderNode]
  );

  const handleSelectCustom = useCallback(() => {
    addNode('provider');
    setIsOpen(false);
  }, [addNode]);

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        style={{ ...btnStyle, borderColor: '#3b82f6', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
          <CustomProviderIcon style={{ width: 16, height: 16 }} />
        </span>
        Provider ▾
      </button>
      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownSectionHeaderStyle}>Preset Providers</div>
          {PRESET_PROVIDERS.map((preset) => {
            const Icon = getProviderIcon(preset.icon);
            return (
              <div
                key={preset.id}
                style={{ ...dropdownItemStyle, borderBottom: '1px solid #f1f5f9' }}
                onClick={() => handleSelectPreset(preset.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f1f5f9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center' }}>
                  {Icon && <Icon style={{ width: 18, height: 18 }} />}
                </span>
                <span style={{ flex: 1 }}>{preset.name}</span>
              </div>
            );
          })}
          <div style={dropdownSectionHeaderStyle}>Custom</div>
          <div
            style={{ ...dropdownItemStyle, borderBottom: 'none' }}
            onClick={handleSelectCustom}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center' }}>
              <CustomProviderIcon style={{ width: 18, height: 18 }} />
            </span>
            <span style={{ flex: 1 }}>Custom Provider</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Middleware Dropdown Component
// ---------------------------------------------------------------------------

/** Available middleware sub-types. */
const MIDDLEWARE_OPTIONS: { type: NodeType; label: string; icon: string; description: string }[] = [
  { type: 'switcher', label: 'Switcher', icon: '🔀', description: '按匹配规则路由请求' },
];

function MiddlewareDropdownButton() {
  const addNode = useFlowStore((s) => s.addNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (type: NodeType) => {
      addNode(type);
      setIsOpen(false);
    },
    [addNode],
  );

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        style={{ ...btnStyle, borderColor: '#f59e0b', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
          🔧
        </span>
        Middleware ▾
      </button>
      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownSectionHeaderStyle}>中间件类型</div>
          {MIDDLEWARE_OPTIONS.map(({ type, label, icon, description }) => (
            <div
              key={type}
              style={{ ...dropdownItemStyle, borderBottom: 'none' }}
              onClick={() => handleSelect(type)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', fontSize: 14 }}>
                {icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application Dropdown Component
// ---------------------------------------------------------------------------

/** Available application sub-types. */
const APPLICATION_OPTIONS: { type: NodeType; label: string; icon: string; description: string }[] = [
  { type: 'application', label: '自定义监听', icon: '📡', description: '监听默认端口的请求入口' },
];

function ApplicationDropdownButton() {
  const addNode = useFlowStore((s) => s.addNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (type: NodeType) => {
      addNode(type);
      setIsOpen(false);
    },
    [addNode],
  );

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        style={{ ...btnStyle, borderColor: '#16a34a', color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
          🖥️
        </span>
        Application ▾
      </button>
      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownSectionHeaderStyle}>应用类型</div>
          {APPLICATION_OPTIONS.map(({ type, label, icon, description }) => (
            <div
              key={type}
              style={{ ...dropdownItemStyle, borderBottom: 'none' }}
              onClick={() => handleSelect(type)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', fontSize: 14 }}>
                {icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <div style={toolbarStyle}>
      {/* Provider dropdown */}
      <ProviderDropdownButton />

      {/* Middleware dropdown */}
      <MiddlewareDropdownButton />

      {/* Application dropdown */}
      <ApplicationDropdownButton />

      <div style={separatorStyle} />

      {/* Zoom controls */}
      <button style={btnStyle} onClick={() => zoomIn()} title="Zoom In">
        +
      </button>
      <button style={btnStyle} onClick={() => zoomOut()} title="Zoom Out">
        −
      </button>
      <button style={btnStyle} onClick={handleFitView} title="Fit View">
        ⊞
      </button>
    </div>
  );
}
