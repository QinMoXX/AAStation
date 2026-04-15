import { useCallback, useState, useRef, useEffect } from 'react';
import { useFlowStore, PRESET_PROVIDERS } from '../../store/flow-store';
import { useNavStore, type HomeSubTab } from '../../store/nav-store';
import type { NodeType } from '../../types';
import { getProviderIcon, CustomProviderIcon } from '../icons/ProviderIcons';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const subNavStyle: React.CSSProperties = {
  height: 48,
  background: '#fff',
  borderBottom: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  gap: 6,
  flexShrink: 0,
};

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid',
  borderColor: active ? '#3b82f6' : '#cbd5e1',
  borderRadius: 6,
  background: active ? '#eff6ff' : '#fff',
  color: active ? '#3b82f6' : '#475569',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

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
// Constants
// ---------------------------------------------------------------------------

const MIDDLEWARE_OPTIONS: { type: NodeType; label: string; icon: string }[] = [
  { type: 'switcher', label: 'Switcher', icon: '🔀' },
];

const APPLICATION_OPTIONS: { type: NodeType; label: string; icon: string }[] = [
  { type: 'application', label: '自定义监听', icon: '📡' },
];

// ---------------------------------------------------------------------------
// Provider Dropdown
// ---------------------------------------------------------------------------

function ProviderDropdown({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const addNode = useFlowStore((s) => s.addNode);
  const addPresetProviderNode = useFlowStore((s) => s.addPresetProviderNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) setIsOpen(false);
  }, [active]);

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

  const handleToggle = () => {
    setIsOpen(!isOpen);
    onOpen();
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button style={tabBtnStyle(active)} onClick={handleToggle}>
        <CustomProviderIcon style={{ width: 16, height: 16 }} />
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
// Middleware Dropdown
// ---------------------------------------------------------------------------

function MiddlewareDropdown({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const addNode = useFlowStore((s) => s.addNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) setIsOpen(false);
  }, [active]);

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
    [addNode]
  );

  const handleToggle = () => {
    setIsOpen(!isOpen);
    onOpen();
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button style={tabBtnStyle(active)} onClick={handleToggle}>
        <span style={{ fontSize: 14 }}>🔧</span>
        Middleware ▾
      </button>
      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownSectionHeaderStyle}>中间件类型</div>
          {MIDDLEWARE_OPTIONS.map(({ type, label, icon }) => (
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
              <span style={{ flex: 1 }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application Dropdown
// ---------------------------------------------------------------------------

function ApplicationDropdown({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const addNode = useFlowStore((s) => s.addNode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) setIsOpen(false);
  }, [active]);

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
    [addNode]
  );

  const handleToggle = () => {
    setIsOpen(!isOpen);
    onOpen();
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button style={tabBtnStyle(active)} onClick={handleToggle}>
        <span style={{ fontSize: 14 }}>🖥️</span>
        Application ▾
      </button>
      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownSectionHeaderStyle}>应用类型</div>
          {APPLICATION_OPTIONS.map(({ type, label, icon }) => (
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
              <span style={{ flex: 1 }}>{label}</span>
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

export default function HomeSubNav() {
  const { homeSubTab, setHomeSubTab } = useNavStore();

  return (
    <div style={subNavStyle}>
      <ProviderDropdown active={homeSubTab === 'provider'} onOpen={() => setHomeSubTab('provider')} />
      <MiddlewareDropdown active={homeSubTab === 'middleware'} onOpen={() => setHomeSubTab('middleware')} />
      <ApplicationDropdown active={homeSubTab === 'application'} onOpen={() => setHomeSubTab('application')} />
    </div>
  );
}
