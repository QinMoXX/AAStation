import { useState, useCallback } from 'react';
import { useFlowStore, PRESET_PROVIDERS } from '../../store/flow-store';
import { getProviderIcon, CustomProviderIcon } from '../icons/ProviderIcons';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  width: 256,
  height: '100%',
  background: '#f9fafb',
  borderRight: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  overflowY: 'auto',
};

const panelHeaderStyle: React.CSSProperties = {
  padding: '20px 16px 12px',
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#374151',
};

const sectionStyle: React.CSSProperties = {
  padding: '0 8px 8px',
};

const categoryHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  cursor: 'pointer',
  borderRadius: 6,
  userSelect: 'none',
  transition: 'background 0.15s',
};

const chevronStyle: React.CSSProperties = {
  display: 'inline-flex',
  fontSize: 13,
  fontWeight: 400,
  color: '#9ca3af',
  width: 14,
  textAlign: 'center',
  fontFamily: 'monospace',
  lineHeight: 1,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px 5px 28px',
  fontSize: 13,
  color: '#374151',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const itemHoverBg = '#e5e7eb';

const itemCountStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
  marginLeft: 'auto',
};

const categoryIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Category Data
// ---------------------------------------------------------------------------

interface CategoryDef {
  id: string;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'application',
    label: '应用',
    color: '#22c55e',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
  },
  {
    id: 'middleware',
    label: '中间件',
    color: '#f97316',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m15 9 6-6" />
      </svg>
    ),
  },
  {
    id: 'provider',
    label: '供应商',
    color: '#3b82f6',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeSubNav() {
  const addNode = useFlowStore((s) => s.addNode);
  const addPresetProviderNode = useFlowStore((s) => s.addPresetProviderNode);
  const nodes = useFlowStore((s) => s.nodes);

  const switcherCount = nodes.filter((n) => n.data.nodeType === 'switcher').length;
  const appCount = nodes.filter((n) => n.data.nodeType === 'application').length;
  const providerCount = nodes.filter((n) => n.data.nodeType === 'provider').length;

  // Track which categories are expanded (all open by default)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    application: true,
    middleware: true,
    provider: true,
  });

  const toggleCategory = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleAddPreset = useCallback(
    (presetId: string) => {
      addPresetProviderNode(presetId);
    },
    [addPresetProviderNode],
  );

  const handleAddCustom = useCallback(() => {
    addNode('provider');
  }, [addNode]);

  const getCategoryCount = useCallback(
    (id: string) => {
      switch (id) {
        case 'application': return appCount;
        case 'middleware': return switcherCount;
        case 'provider': return providerCount;
        default: return 0;
      }
    },
    [appCount, switcherCount, providerCount],
  );

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle} data-tauri-drag-region>
        <div style={panelTitleStyle}>节点组件</div>
      </div>

      <div style={sectionStyle}>
        {CATEGORIES.map((cat, catIdx) => {
          const isOpen = expanded[cat.id];
          const count = getCategoryCount(cat.id);

          return (
            <div key={cat.id} style={{ marginBottom: 8 }}>
              {/* Category header - clickable to expand/collapse */}
              <div
                style={categoryHeaderStyle}
                onClick={() => toggleCategory(cat.id)}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#e5e7eb'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={chevronStyle}>{isOpen ? '−' : '+'}</span>
                <span style={categoryIconStyle}>{cat.icon}</span>
                <span>{cat.label}</span>
                {count > 0 && <span style={itemCountStyle}>{count}</span>}
              </div>

              {/* Category items */}
              {isOpen && (
                <div>
                  {/* Application items */}
                  {cat.id === 'application' && (
                    <div
                      style={itemStyle}
                      onClick={() => addNode('application')}
                      onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={categoryIconStyle}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
                        </svg>
                      </span>
                      <span style={{ fontWeight: 500 }}>自定义监听</span>
                    </div>
                  )}

                  {/* Middleware items */}
                  {cat.id === 'middleware' && (
                    <div
                      style={itemStyle}
                      onClick={() => addNode('switcher')}
                      onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={categoryIconStyle}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m15 9 6-6" />
                        </svg>
                      </span>
                      <span style={{ fontWeight: 500 }}>Switcher</span>
                    </div>
                  )}

                  {/* Provider items */}
                  {cat.id === 'provider' && (
                    <>
                      {PRESET_PROVIDERS.map((preset) => {
                        const Icon = getProviderIcon(preset.icon);
                        return (
                          <div
                            key={preset.id}
                            style={itemStyle}
                            onClick={() => handleAddPreset(preset.id)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span style={{ fontWeight: 500 }}>{preset.name}</span>
                          </div>
                        );
                      })}
                      <div
                        style={itemStyle}
                        onClick={handleAddCustom}
                        onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={categoryIconStyle}>
                          <CustomProviderIcon style={{ width: 14, height: 14 }} />
                        </span>
                        <span style={{ fontWeight: 500 }}>Custom Provider</span>
                      </div>
                    </>
                  )}
                </div>
              )}
              {catIdx < CATEGORIES.length - 1 && (
                <div style={{ height: 1, background: '#e5e7eb', margin: '6px 8px 0' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
