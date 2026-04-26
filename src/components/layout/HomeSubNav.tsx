import { useState, useCallback, useMemo } from 'react';
import { useFlowStore, PRESET_PROVIDERS, APPLICATION_DEFAULTS, MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';
import { NodeTag, type AppType, type MiddlewareType } from '../../types';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  width: 256,
  height: '100%',
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
  color: 'var(--ui-text)',
};

const tagFilterWrapStyle: React.CSSProperties = {
  marginTop: 10,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const tagChipBaseStyle: React.CSSProperties = {
  height: 22,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid rgba(255, 255, 255, 0.16)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'all 0.15s',
};

const tagChipBorderColor = 'rgba(255, 255, 255, 0.16)';

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
  color: 'var(--ui-text)',
  cursor: 'pointer',
  borderRadius: 6,
  userSelect: 'none',
  transition: 'background 0.15s',
};

const chevronStyle: React.CSSProperties = {
  display: 'inline-flex',
  fontSize: 13,
  fontWeight: 400,
  color: 'var(--ui-dim)',
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
  color: 'var(--ui-muted)',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const itemHoverBg = 'rgba(255, 255, 255, 0.05)';

const itemCountStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ui-dim)',
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

const emptyTextStyle: React.CSSProperties = {
  padding: '6px 8px 6px 28px',
  fontSize: 12,
  color: 'var(--ui-dim)',
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

const TAG_OPTIONS: NodeTag[] = [
  NodeTag.Any,
  NodeTag.ClaudeCode,
  NodeTag.OpenCode,
  NodeTag.CodexCli,
];

const TAG_LABEL_MAP: Record<NodeTag, string> = {
  [NodeTag.Any]: '全部',
  [NodeTag.ClaudeCode]: 'Claude Code',
  [NodeTag.OpenCode]: 'OpenCode',
  [NodeTag.CodexCli]: 'Codex CLI',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeSubNav() {
  const addNode = useFlowStore((s) => s.addNode);
  const addMiddlewareNode = useFlowStore((s) => s.addMiddlewareNode);
  const addPresetProviderNode = useFlowStore((s) => s.addPresetProviderNode);
  const nodes = useFlowStore((s) => s.nodes);
  const applicationItems = useMemo(
    () => Object.entries(APPLICATION_DEFAULTS) as [AppType, (typeof APPLICATION_DEFAULTS)[AppType]][],
    []
  );
  const middlewareItems = useMemo(
    () => Object.entries(MIDDLEWARE_CONFIG) as [MiddlewareType, (typeof MIDDLEWARE_CONFIG)[MiddlewareType]][],
    []
  );
  const [selectedTag, setSelectedTag] = useState<NodeTag>(NodeTag.Any);

  const middlewareCount = nodes.filter((n) => n.data.nodeType === 'switcher' || n.data.nodeType === 'poller').length;
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

  const matchByTag = useCallback(
    (itemTags: NodeTag[]) =>
      selectedTag === NodeTag.Any ||
      itemTags.includes(NodeTag.Any) ||
      itemTags.includes(selectedTag),
    [selectedTag],
  );

  const filteredApplicationItems = useMemo(
    () => applicationItems.filter(([, appDefault]) => matchByTag(appDefault.tag)),
    [applicationItems, matchByTag],
  );

  const filteredMiddlewareItems = useMemo(
    () => middlewareItems.filter(([, middleware]) => matchByTag(middleware.tag)),
    [middlewareItems, matchByTag],
  );

  const filteredProviderPresets = useMemo(
    () => PRESET_PROVIDERS.filter((preset) => matchByTag(preset.tag)),
    [matchByTag],
  );

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
        case 'middleware': return middlewareCount;
        case 'provider': return providerCount;
        default: return 0;
      }
    },
    [appCount, middlewareCount, providerCount],
  );

  return (
    <div style={panelStyle} className="ui-subsidebar">
      <div style={panelHeaderStyle} data-tauri-drag-region>
        <div style={panelTitleStyle}>节点组件</div>
        <div style={tagFilterWrapStyle}>
          {TAG_OPTIONS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <div
                key={tag}
                style={{
                  ...tagChipBaseStyle,
                  borderColor: active ? 'rgba(99, 102, 241, 0.65)' : tagChipBorderColor,
                  background: active ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                  color: active ? '#c7d2fe' : 'var(--ui-muted)',
                }}
                onClick={() => setSelectedTag(tag)}
              >
                {TAG_LABEL_MAP[tag]}
              </div>
            );
          })}
        </div>
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
                onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
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
                    <>
                      {filteredApplicationItems.map(([appType, appDefault]) => {
                        const Icon = getProviderIcon(appDefault.icon);
                        return (
                          <div
                            key={appType}
                            style={itemStyle}
                            onClick={() => addNode('application', undefined, appType === 'listener' ? undefined : appType)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span style={{ fontWeight: 500 }}>
                              {appDefault.displayLabel}
                            </span>
                          </div>
                        );
                      })}
                      {filteredApplicationItems.length === 0 && (
                        <div style={emptyTextStyle}>当前筛选下无可用应用节点</div>
                      )}
                    </>
                  )}

                  {/* Middleware items */}
                  {cat.id === 'middleware' && (
                    <>
                      {filteredMiddlewareItems.map(([middlewareType, middleware]) => {
                        const Icon = getProviderIcon(middleware.icon);
                        return (
                          <div
                            key={middlewareType}
                            style={itemStyle}
                            onClick={() => addMiddlewareNode(middlewareType)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span style={{ fontWeight: 500 }}>{middleware.name}</span>
                          </div>
                        );
                      })}
                      {filteredMiddlewareItems.length === 0 && (
                        <div style={emptyTextStyle}>当前筛选下无可用中间件节点</div>
                      )}
                    </>
                  )}

                  {/* Provider items */}
                  {cat.id === 'provider' && (
                    <>
                      {filteredProviderPresets.map((preset) => {
                        const Icon = getProviderIcon(preset.icon);
                        const isCustomProvider = preset.createMode === 'custom';
                        return (
                          <div
                            key={preset.id}
                            style={itemStyle}
                            onClick={() => (isCustomProvider ? handleAddCustom() : handleAddPreset(preset.id))}
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
                      {filteredProviderPresets.length === 0 && (
                        <div style={emptyTextStyle}>当前筛选下无可用供应商节点</div>
                      )}
                    </>
                  )}
                </div>
              )}
              {catIdx < CATEGORIES.length - 1 && (
                <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '6px 8px 0' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
