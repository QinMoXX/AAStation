import { useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, PRESET_PROVIDERS, APPLICATION_DEFAULTS, MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';
import { NodeTag, type AppType, type MiddlewareType } from '../../types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ChevronRight, Monitor, Waypoints, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    icon: <Monitor className="w-3.5 h-3.5" style={{ color: '#22c55e' }} />,
  },
  {
    id: 'middleware',
    label: '中间件',
    color: '#f97316',
    icon: <Waypoints className="w-3.5 h-3.5" style={{ color: '#f97316' }} />,
  },
  {
    id: 'provider',
    label: '供应商',
    color: '#3b82f6',
    icon: <Layers className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />,
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
  if (helpText) return helpText.split(/[。.!?]/)[0]?.trim() || '应用入口节点';
  switch (appType) {
    case 'claude_code': return 'Claude Code 代理入口';
    case 'open_code': return 'OpenCode 代理入口';
    case 'codex_cli': return 'Codex CLI 代理入口';
    default: return '通用应用监听入口';
  }
}

function getMiddlewareDesc(type: MiddlewareType): string {
  switch (type) {
    case 'switcher': return '按模型、路径或请求头分流';
    case 'poller': return '按策略动态选择下游目标';
    default: return '中间件节点';
  }
}

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
      selectedTag === NodeTag.Any || itemTags.includes(NodeTag.Any) || itemTags.includes(selectedTag),
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
    (presetId: string) => { addPresetProviderNode(presetId); },
    [addPresetProviderNode],
  );
  const handleAddCustom = useCallback(() => { addNode('provider'); }, [addNode]);

  const getCategoryCount = useCallback(
    (id: string) => {
      switch (id) { case 'application': return appCount; case 'middleware': return middlewareCount; case 'provider': return providerCount; default: return 0; }
    },
    [appCount, middlewareCount, providerCount],
  );

  return (
    <div className="w-[272px] h-full flex flex-col shrink-0 border-r border-border-soft bg-sidebar-surface backdrop-blur-xl">
      <div className="px-[18px] pt-[22px] pb-[14px] border-b border-border-soft" data-tauri-drag-region>
        <div className="text-sm font-bold text-foreground">节点组件</div>
        <div className="flex flex-wrap gap-2 mt-3">
          {TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={cn(
                "inline-flex items-center justify-center min-h-[28px] px-3 rounded-full border text-[11px] font-semibold leading-none cursor-pointer transition-all duration-200",
                selectedTag === tag
                  ? "border-border bg-card text-foreground shadow-[var(--color-shadow-soft)]"
                  : "border-border bg-surface/60 text-muted hover:border-border-strong hover:text-foreground"
              )}
              onClick={() => setSelectedTag(tag)}
            >
              {TAG_LABEL_MAP[tag]}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2.5 pb-3.5">
          {CATEGORIES.map((cat, catIdx) => {
            const isOpen = expanded[cat.id];
            const count = getCategoryCount(cat.id);

            return (
              <div key={cat.id} className="mb-2.5">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl border border-transparent bg-transparent text-foreground cursor-pointer text-left transition-all duration-200 hover:border-border hover:bg-surface/70"
                  onClick={() => toggleCategory(cat.id)}
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-dim" /> : <ChevronRight className="w-3.5 h-3.5 text-dim" />}
                  <span className="w-4 h-4 flex items-center justify-center shrink-0">{cat.icon}</span>
                  <span>{cat.label}</span>
                  {count > 0 && (
                    <span className="ml-auto min-w-[22px] h-[22px] px-[7px] rounded-full border border-border bg-card/80 text-dim text-[11px] inline-flex items-center justify-center">
                      {count}
                    </span>
                  )}
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
                              className="w-full flex items-start gap-2.5 mt-1 px-2.5 py-2.5 pl-[30px] rounded-[14px] border border-transparent bg-transparent text-muted cursor-pointer text-left transition-all duration-200 hover:border-border hover:bg-surface/70 hover:text-foreground"
                              onClick={() => addNode('application', undefined, appType === 'listener' ? undefined : appType)}
                            >
                              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                                {Icon && <Icon className="w-3.5 h-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-foreground">{appDefault.displayLabel}</span>
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-dim">
                                  {getApplicationDesc(appType, appDefault.helpText)}
                                </span>
                              </span>
                              <Badge variant="outline" className="shrink-0 h-[22px] text-[10px] px-2 border-border bg-card/80 text-dim">应用</Badge>
                            </button>
                          );
                        })}
                        {filteredApplicationItems.length === 0 && (
                          <div className="px-2.5 pl-[30px] py-2 text-dim text-xs">当前筛选下无可用应用节点</div>
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
                              className="w-full flex items-start gap-2.5 mt-1 px-2.5 py-2.5 pl-[30px] rounded-[14px] border border-transparent bg-transparent text-muted cursor-pointer text-left transition-all duration-200 hover:border-border hover:bg-surface/70 hover:text-foreground"
                              onClick={() => addMiddlewareNode(middlewareType)}
                            >
                              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                                {Icon && <Icon className="w-3.5 h-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-foreground">{middleware.name}</span>
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-dim">{getMiddlewareDesc(middlewareType)}</span>
                              </span>
                              <Badge variant="outline" className="shrink-0 h-[22px] text-[10px] px-2 border-border bg-card/80 text-dim">中间件</Badge>
                            </button>
                          );
                        })}
                        {filteredMiddlewareItems.length === 0 && (
                          <div className="px-2.5 pl-[30px] py-2 text-dim text-xs">当前筛选下无可用中间件节点</div>
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
                              className="w-full flex items-start gap-2.5 mt-1 px-2.5 py-2.5 pl-[30px] rounded-[14px] border border-transparent bg-transparent text-muted cursor-pointer text-left transition-all duration-200 hover:border-border hover:bg-surface/70 hover:text-foreground"
                              onClick={() => (isCustomProvider ? handleAddCustom() : handleAddPreset(preset.id))}
                            >
                              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                                {Icon && <Icon className="w-3.5 h-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-foreground">{preset.name}</span>
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-dim">{providerDesc}</span>
                              </span>
                              <Badge variant="outline" className="shrink-0 h-[22px] text-[10px] px-2 border-border bg-card/80 text-dim">
                                {isCustomProvider ? '自定义' : '预设'}
                              </Badge>
                            </button>
                          );
                        })}
                        {filteredProviderPresets.length === 0 && (
                          <div className="px-2.5 pl-[30px] py-2 text-dim text-xs">当前筛选下无可用供应商节点</div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {catIdx < CATEGORIES.length - 1 && (
                  <Separator className="my-2.5 mx-2 bg-border-soft" />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
