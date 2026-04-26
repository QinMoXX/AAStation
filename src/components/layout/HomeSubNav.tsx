import { useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, PRESET_PROVIDERS, APPLICATION_DEFAULTS, MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';
import { NodeTag, type AppType, type MiddlewareType } from '../../types';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

function getApplicationDesc(appType: AppType, helpText?: string): string {
  if (helpText) {
    return helpText.split(/[。.!?]/)[0]?.trim() || '应用入口节点';
  }
  switch (appType) {
    case 'claude_code':
      return 'Claude Code 代理入口';
    case 'open_code':
      return 'OpenCode 代理入口';
    case 'codex_cli':
      return 'Codex CLI 代理入口';
    default:
      return '通用应用监听入口';
  }
}

function getMiddlewareDesc(type: MiddlewareType): string {
  switch (type) {
    case 'switcher':
      return '按模型、路径或请求头分流';
    case 'poller':
      return '按策略动态选择下游目标';
    default:
      return '中间件节点';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeSubNav() {
  const {
    addNode,
    addMiddlewareNode,
    addPresetProviderNode,
    appCount,
    middlewareCount,
    providerCount,
  } = useFlowStore(useShallow(useCallback((s) => ({
      addNode: s.addNode,
      addMiddlewareNode: s.addMiddlewareNode,
      addPresetProviderNode: s.addPresetProviderNode,
      appCount: s.nodes.filter((n) => n.data.nodeType === 'application').length,
      middlewareCount: s.nodes.filter((n) => n.data.nodeType === 'switcher' || n.data.nodeType === 'poller').length,
      providerCount: s.nodes.filter((n) => n.data.nodeType === 'provider').length,
    }), [])));
  const applicationItems = useMemo(
    () => Object.entries(APPLICATION_DEFAULTS) as [AppType, (typeof APPLICATION_DEFAULTS)[AppType]][],
    []
  );
  const middlewareItems = useMemo(
    () => Object.entries(MIDDLEWARE_CONFIG) as [MiddlewareType, (typeof MIDDLEWARE_CONFIG)[MiddlewareType]][],
    []
  );
  const [selectedTag, setSelectedTag] = useState<NodeTag>(NodeTag.Any);

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
    <div className="ui-subnav ui-subsidebar">
      <div className="ui-subnav-header" data-tauri-drag-region>
        <div className="ui-subnav-title">节点组件</div>
        <div className="ui-chip-group">
          {TAG_OPTIONS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                type="button"
                className={`ui-chip${active ? ' active' : ''}`}
                onClick={() => setSelectedTag(tag)}
              >
                {TAG_LABEL_MAP[tag]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ui-subnav-section">
        {CATEGORIES.map((cat, catIdx) => {
          const isOpen = expanded[cat.id];
          const count = getCategoryCount(cat.id);

          return (
            <div key={cat.id} className="ui-subnav-category">
              <button
                type="button"
                className="ui-subnav-category-header"
                onClick={() => toggleCategory(cat.id)}
              >
                <span style={chevronStyle}>{isOpen ? '−' : '+'}</span>
                <span style={categoryIconStyle}>{cat.icon}</span>
                <span>{cat.label}</span>
                {count > 0 && <span className="ui-subnav-category-count">{count}</span>}
              </button>

              {isOpen && (
                <div>
                  {cat.id === 'application' && (
                    <>
                      {filteredApplicationItems.map(([appType, appDefault]) => {
                        const Icon = getProviderIcon(appDefault.icon);
                        return (
                          <button
                            key={appType}
                            type="button"
                            className="ui-subnav-item"
                            onClick={() => addNode('application', undefined, appType === 'listener' ? undefined : appType)}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span className="ui-subnav-item-main">
                              <span className="ui-subnav-item-title">{appDefault.displayLabel}</span>
                              <span className="ui-subnav-item-desc">
                                {getApplicationDesc(appType, appDefault.helpText)}
                              </span>
                            </span>
                            <span className="ui-subnav-item-badge">应用</span>
                          </button>
                        );
                      })}
                      {filteredApplicationItems.length === 0 && (
                        <div className="ui-subnav-empty">当前筛选下无可用应用节点</div>
                      )}
                    </>
                  )}

                  {cat.id === 'middleware' && (
                    <>
                      {filteredMiddlewareItems.map(([middlewareType, middleware]) => {
                        const Icon = getProviderIcon(middleware.icon);
                        return (
                          <button
                            key={middlewareType}
                            type="button"
                            className="ui-subnav-item"
                            onClick={() => addMiddlewareNode(middlewareType)}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span className="ui-subnav-item-main">
                              <span className="ui-subnav-item-title">{middleware.name}</span>
                              <span className="ui-subnav-item-desc">{getMiddlewareDesc(middlewareType)}</span>
                            </span>
                            <span className="ui-subnav-item-badge">中间件</span>
                          </button>
                        );
                      })}
                      {filteredMiddlewareItems.length === 0 && (
                        <div className="ui-subnav-empty">当前筛选下无可用中间件节点</div>
                      )}
                    </>
                  )}

                  {cat.id === 'provider' && (
                    <>
                      {filteredProviderPresets.map((preset) => {
                        const Icon = getProviderIcon(preset.icon);
                        const isCustomProvider = preset.createMode === 'custom';
                        const providerDesc = isCustomProvider
                          ? '创建自定义供应商节点'
                          : preset.models.length > 0
                            ? `${preset.models.length} 个模型预设`
                            : '快速添加供应商节点';
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            className="ui-subnav-item"
                            onClick={() => (isCustomProvider ? handleAddCustom() : handleAddPreset(preset.id))}
                          >
                            <span style={categoryIconStyle}>
                              {Icon && <Icon style={{ width: 14, height: 14 }} />}
                            </span>
                            <span className="ui-subnav-item-main">
                              <span className="ui-subnav-item-title">{preset.name}</span>
                              <span className="ui-subnav-item-desc">{providerDesc}</span>
                            </span>
                            <span className="ui-subnav-item-badge">
                              {isCustomProvider ? '自定义' : '预设'}
                            </span>
                          </button>
                        );
                      })}
                      {filteredProviderPresets.length === 0 && (
                        <div className="ui-subnav-empty">当前筛选下无可用供应商节点</div>
                      )}
                    </>
                  )}
                </div>
              )}
              {catIdx < CATEGORIES.length - 1 && (
                <div className="ui-subnav-divider" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
