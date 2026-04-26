import { useCallback, useMemo } from 'react';
import { useFlowStore, PRESET_PROVIDERS, APPLICATION_DEFAULTS, MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import type {
  ProviderNodeData,
  SwitcherNodeData,
  PollerNodeData,
  ApplicationNodeData,
  AAStationNodeData,
  ProviderModel,
  SwitcherEntry,
  PollerTarget,
} from '../../types';
import { NodeTag } from '../../types';
import { getProviderIcon } from '../icons/ProviderIcons';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const tagLabelMap: Record<NodeTag, string> = {
  [NodeTag.Any]: 'ANY',
  [NodeTag.ClaudeCode]: 'CLAUDE_CODE',
  [NodeTag.OpenCode]: 'OPEN_CODE',
  [NodeTag.CodexCli]: 'CODEX_CLI',
};

const panelFieldClass =
  'rounded-xl border-[rgba(120,146,190,0.20)] bg-[rgba(7,14,28,0.94)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';

const panelCardClass =
  'rounded-2xl border-[rgba(120,146,190,0.18)] bg-[rgba(12,22,42,0.96)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]';

const panelPillButtonClass =
  'h-5 rounded-full px-2 text-[9px] font-medium gap-1 [&_svg]:size-3';

const panelDangerPillButtonClass =
  'h-5 rounded-full px-2 text-[9px] font-medium gap-1 bg-destructive/16 border-destructive/24 text-rose-200 hover:bg-destructive/24 [&_svg]:size-3';

// ---------------------------------------------------------------------------
// Provider form
// ---------------------------------------------------------------------------

function ProviderForm({ data, onUpdate }: { data: ProviderNodeData; onUpdate: (patch: Partial<ProviderNodeData>) => void }) {
  const preset = useMemo(
    () => PRESET_PROVIDERS.find((p) => p.id === data.presetId),
    [data.presetId]
  );
  const isPreset = !!preset;

  const availablePresetModels = useMemo(() => {
    if (!preset) return [];
    const existingNames = new Set(data.models.map((m) => m.name));
    return preset.models.filter((m) => !existingNames.has(m.name));
  }, [preset, data.models]);

  const addModel = useCallback(() => {
    const newModel: ProviderModel = {
      id: crypto.randomUUID(),
      name: '',
      enabled: true,
    };
    onUpdate({ models: [...data.models, newModel] });
  }, [data.models, onUpdate]);

  const addPresetModel = useCallback(
    (modelName: string) => {
      const newModel: ProviderModel = {
        id: crypto.randomUUID(),
        name: modelName,
        enabled: true,
      };
      onUpdate({ models: [...data.models, newModel] });
    },
    [data.models, onUpdate]
  );

  const removeModel = useCallback(
    (modelId: string) => {
      onUpdate({ models: data.models.filter((m) => m.id !== modelId) });
    },
    [data.models, onUpdate],
  );

  const updateModel = useCallback(
    (modelId: string, patch: Partial<ProviderModel>) => {
      onUpdate({
        models: data.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)),
      });
    },
    [data.models, onUpdate],
  );

  return (
    <div className="flex flex-col gap-3">
      {isPreset && (() => {
        const Icon = getProviderIcon(preset.icon);
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-warning/10 border border-warning-border rounded-xl text-xs text-warning-foreground">
            <span className="w-4 h-4 flex items-center justify-center">
              {Icon && <Icon className="w-4 h-4" />}
            </span>
            <strong>{preset.name}</strong> 预设供应商，地址不可修改
          </div>
        );
      })()}

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">名称</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={panelFieldClass}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">OpenAI 基础地址</Label>
        <Input
          value={data.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          disabled={isPreset}
          className={cn(
            panelFieldClass,
            isPreset && "opacity-60 cursor-not-allowed"
          )}
        />
        <p className="text-[10px] text-dim">需要包含版本路径，例如 `/v1`。用于 OpenAI 兼容请求。</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">Anthropic 基础地址 <span className="text-dim font-normal">(可选)</span></Label>
        <Input
          value={data.anthropicBaseUrl || ''}
          placeholder="https://open.bigmodel.cn/api/anthropic"
          onChange={(e) => onUpdate({ anthropicBaseUrl: e.target.value || undefined })}
          disabled={isPreset}
          className={cn(
            panelFieldClass,
            isPreset && "opacity-60 cursor-not-allowed"
          )}
        />
        <p className="text-[10px] text-dim">不需要版本路径。设置后，Anthropic 兼容请求会直接使用这个地址。</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">API 密钥</Label>
        <Input
          type="password"
          value={data.apiKey}
          placeholder="sk-..."
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
          className={panelFieldClass}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">Token 预算 <span className="text-dim font-normal">(单位：百万)</span></Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={data.tokenLimit ?? ''}
          placeholder="留空 = 不限"
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onUpdate({ tokenLimit: undefined });
              return;
            }
            const parsed = Math.floor(Number(raw));
            onUpdate({ tokenLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
          }}
          className={panelFieldClass}
        />
        <p className="text-[10px] text-dim">按百万配置额度，留空表示无限制。</p>
      </div>

      {/* Models section */}
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-dim uppercase tracking-wider">模型列表</span>
        <div className="flex gap-1">
          {isPreset && availablePresetModels.length > 0 && (
            <Select onValueChange={(val) => { if (val) addPresetModel(val); }}>
            <SelectTrigger className={cn('h-7 w-auto text-[9px]', panelFieldClass)}>
                <SelectValue placeholder="+ 快速添加" />
              </SelectTrigger>
              <SelectContent>
                {availablePresetModels.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.label || m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="accent" size="xs" onClick={addModel} className={panelPillButtonClass}>
            <Plus className="w-3 h-3" /> 自定义
          </Button>
        </div>
      </div>

      {data.models.length === 0 && (
        <p className="text-xs text-dim">
          暂无模型。{isPreset ? '可使用"快速添加"或' : ''}点击"+ 自定义"创建。
        </p>
      )}

      {data.models.map((model, index) => (
        <Card key={model.id} className={panelCardClass}>
          <CardContent className="p-2.5 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-accent-foreground">模型 #{index + 1}</span>
              <Button variant="danger" size="xs" onClick={() => removeModel(model.id)} className={panelDangerPillButtonClass}>
                <Trash2 className="w-3 h-3" /> 删除
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-muted text-xs">模型名称</Label>
              <Input
                value={model.name}
                placeholder="gpt-4o"
                onChange={(e) => updateModel(model.id, { name: e.target.value })}
                className={cn('h-9 text-sm', panelFieldClass)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={model.enabled}
                onCheckedChange={(checked) => updateModel(model.id, { enabled: !!checked })}
              />
              <span className="text-[11px] text-muted">启用</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switcher form
// ---------------------------------------------------------------------------

function SwitcherForm({ data, onUpdate }: { data: SwitcherNodeData; onUpdate: (patch: Partial<SwitcherNodeData>) => void }) {
  const addEntry = useCallback(() => {
    const newEntry: SwitcherEntry = {
      id: crypto.randomUUID(),
      label: '',
      matchType: 'model',
      pattern: '',
    };
    onUpdate({ entries: [...data.entries, newEntry] });
  }, [data.entries, onUpdate]);

  const removeEntry = useCallback(
    (entryId: string) => {
      onUpdate({ entries: data.entries.filter((e) => e.id !== entryId) });
    },
    [data.entries, onUpdate],
  );

  const updateEntry = useCallback(
    (entryId: string, patch: Partial<SwitcherEntry>) => {
      onUpdate({
        entries: data.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
      });
    },
    [data.entries, onUpdate],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label className="text-muted text-xs">名称</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={panelFieldClass}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          checked={data.hasDefault}
          onCheckedChange={(checked) => onUpdate({ hasDefault: !!checked })}
        />
        <span className="text-xs text-muted">启用默认路由</span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-dim uppercase tracking-wider">匹配器</span>
        <Button variant="warning" size="xs" onClick={addEntry} className="gap-1">
          <Plus className="w-3 h-3" /> 添加
        </Button>
      </div>

      {data.entries.length === 0 && (
        <p className="text-xs text-dim">还没有匹配器。点击"+ 添加"创建一个。</p>
      )}

      {data.entries.map((entry, index) => (
        <Card key={entry.id} className={panelCardClass}>
          <CardContent className="p-2.5 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-warning-foreground">匹配器 #{index + 1}</span>
              <Button variant="danger" size="xs" onClick={() => removeEntry(entry.id)} className={panelDangerPillButtonClass}>
                <Trash2 className="w-3 h-3" /> 删除
              </Button>
            </div>

            <div className="space-y-1">
              <Label className="text-muted text-xs">名称</Label>
              <Input
                value={entry.label}
                placeholder="gpt-4o"
                onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                className={cn('h-9 text-sm', panelFieldClass)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-muted text-xs">匹配类型</Label>
              <Select
                value={entry.matchType}
                onValueChange={(val) => updateEntry(entry.id, { matchType: val as SwitcherEntry['matchType'] })}
              >
                <SelectTrigger className={cn('h-9 text-sm', panelFieldClass)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="model">模型</SelectItem>
                  <SelectItem value="path_prefix">路径前缀</SelectItem>
                  <SelectItem value="header">请求头</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-muted text-xs">匹配模式</Label>
              <Input
                value={entry.pattern}
                placeholder={
                  entry.matchType === 'path_prefix'
                    ? '/v1/messages'
                    : entry.matchType === 'header'
                      ? 'X-Custom:value'
                      : 'claude-sonnet-4-20250514'
                }
                onChange={(e) => updateEntry(entry.id, { pattern: e.target.value })}
                className={cn('h-9 text-sm', panelFieldClass)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poller form
// ---------------------------------------------------------------------------

function PollerForm({ data, onUpdate }: { data: PollerNodeData; onUpdate: (patch: Partial<PollerNodeData>) => void }) {
  const showTargetWeight = data.strategy === 'weighted' || data.strategy === 'round_robin';

  const addTarget = useCallback(() => {
    const newTarget: PollerTarget = {
      id: crypto.randomUUID(),
      label: '',
      enabled: true,
      weight: 1,
    };
    onUpdate({ targets: [...data.targets, newTarget] });
  }, [data.targets, onUpdate]);

  const removeTarget = useCallback(
    (targetId: string) => {
      onUpdate({ targets: data.targets.filter((target) => target.id !== targetId) });
    },
    [data.targets, onUpdate],
  );

  const updateTarget = useCallback(
    (targetId: string, patch: Partial<PollerTarget>) => {
      onUpdate({
        targets: data.targets.map((target) => (target.id === targetId ? { ...target, ...patch } : target)),
      });
    },
    [data.targets, onUpdate],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label className="text-muted text-xs">名称</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={panelFieldClass}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">策略</Label>
        <Select
          value={data.strategy}
          onValueChange={(val) => onUpdate({ strategy: val as PollerNodeData['strategy'] })}
        >
          <SelectTrigger className={panelFieldClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weighted">加权轮询</SelectItem>
            <SelectItem value="network_status">网络状态优先</SelectItem>
            <SelectItem value="token_remaining">剩余额度优先</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-muted text-xs">失败阈值</Label>
          <Input
            type="number"
            min={1}
            value={data.failureThreshold}
            onChange={(e) => onUpdate({ failureThreshold: Math.max(1, Number(e.target.value) || 1) })}
            className={panelFieldClass}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted text-xs">冷却时间(秒)</Label>
          <Input
            type="number"
            min={1}
            value={data.cooldownSeconds}
            onChange={(e) => onUpdate({ cooldownSeconds: Math.max(1, Number(e.target.value) || 1) })}
            className={panelFieldClass}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted text-xs">探测间隔(秒)</Label>
          <Input
            type="number"
            min={5}
            value={data.probeIntervalSeconds}
            onChange={(e) => onUpdate({ probeIntervalSeconds: Math.max(5, Number(e.target.value) || 5) })}
            className={panelFieldClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          checked={data.hasDefault}
          onCheckedChange={(checked) => onUpdate({ hasDefault: !!checked })}
        />
        <span className="text-xs text-muted">启用默认回退</span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-dim uppercase tracking-wider">轮询目标</span>
        <Button variant="purple" size="xs" onClick={addTarget} className="gap-1">
          <Plus className="w-3 h-3" /> 添加
        </Button>
      </div>

      {data.targets.length === 0 && (
        <p className="text-xs text-dim">还没有轮询目标。点击"+ 添加"创建一个。</p>
      )}

      {data.targets.map((target, index) => (
        <Card key={target.id} className={panelCardClass}>
          <CardContent className="p-2.5 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-purple-foreground">目标 #{index + 1}</span>
              <Button variant="danger" size="xs" onClick={() => removeTarget(target.id)} className={panelDangerPillButtonClass}>
                <Trash2 className="w-3 h-3" /> 删除
              </Button>
            </div>

            <div className="space-y-1">
              <Label className="text-muted text-xs">名称</Label>
              <Input
                value={target.label}
                placeholder="供应商 A"
                onChange={(e) => updateTarget(target.id, { label: e.target.value })}
                className={cn('h-9 text-sm', panelFieldClass)}
              />
            </div>

            {showTargetWeight && (
              <div className="space-y-1">
                <Label className="text-muted text-xs">权重</Label>
                <Input
                  type="number"
                  min={1}
                  value={target.weight}
                  onChange={(e) => updateTarget(target.id, { weight: Math.max(1, Number(e.target.value) || 1) })}
                  className={cn('h-9 text-sm', panelFieldClass)}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                checked={target.enabled}
                onCheckedChange={(checked) => updateTarget(target.id, { enabled: !!checked })}
              />
              <span className="text-[11px] text-purple-foreground">启用</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application form
// ---------------------------------------------------------------------------

function ApplicationForm({ data, onUpdate }: { data: ApplicationNodeData; onUpdate: (patch: Partial<ApplicationNodeData>) => void }) {
  const appDefault = APPLICATION_DEFAULTS[data.appType];
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label className="text-muted text-xs">名称</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={panelFieldClass}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted text-xs">监听端口</Label>
        <Input
          type="number"
          value={data.listenPort || ''}
          min={1}
          max={65535}
          placeholder="自动分配"
          onChange={(e) => onUpdate({ listenPort: Number(e.target.value) || 0 })}
          className={panelFieldClass}
        />
        <p className="text-[10px] text-dim">0 = 自动从端口范围分配。每个应用节点监听独立端口。</p>
      </div>

      {appDefault?.helpText && (
        <p className="text-[11px] text-muted leading-relaxed">
          {appDefault.helpText}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main NodePanel
// ---------------------------------------------------------------------------

export default function NodePanel() {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const selectedNode = useFlowStore(
    useCallback(
      (s) => (selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
      [selectedNodeId],
    ),
  );

  const handleUpdate = useCallback(
    (patch: Partial<AAStationNodeData>) => {
      if (selectedNodeId) {
        updateNodeData(selectedNodeId, patch);
      }
    },
    [selectedNodeId, updateNodeData],
  );

  if (!selectedNode) return null;

  const { data } = selectedNode;

  const headerColors: Record<string, string> = {
    provider: '#60a5fa',
    switcher: '#f59e0b',
    poller: '#c084fc',
    application: '#34d399',
  };
  const theme = headerColors[data.nodeType] ?? headerColors.provider;
  const nodeDisplayName =
    data.nodeType === 'switcher' || data.nodeType === 'poller'
      ? MIDDLEWARE_CONFIG[data.nodeType]?.name || data.nodeType || 'Middleware'
      : data.nodeType;
  const appIconKey = data.nodeType === 'application'
    ? APPLICATION_DEFAULTS[data.appType]?.icon
    : '';
  const middlewareIconKey = data.nodeType === 'switcher' || data.nodeType === 'poller'
    ? MIDDLEWARE_CONFIG[data.nodeType]?.icon
    : '';
  const headerIconKey = appIconKey || middlewareIconKey;
  const HeaderIcon = headerIconKey ? getProviderIcon(headerIconKey) : null;
  const nodeTags: NodeTag[] = (() => {
    if (data.nodeType === 'application') {
      return APPLICATION_DEFAULTS[data.appType]?.tag ?? [NodeTag.Any];
    }
    if (data.nodeType === 'switcher') {
      return MIDDLEWARE_CONFIG.switcher?.tag ?? [NodeTag.Any];
    }
    if (data.nodeType === 'poller') {
      return MIDDLEWARE_CONFIG.poller?.tag ?? [NodeTag.Any];
    }
    if (data.nodeType === 'provider') {
      const presetTag = data.presetId
        ? PRESET_PROVIDERS.find((p) => p.id === data.presetId)?.tag
        : undefined;
      return presetTag ?? [NodeTag.Any];
    }
    return [NodeTag.Any];
  })();
  const nodeTagLabel = nodeTags.map((tag) => tagLabelMap[tag] ?? tag).join(' | ');

  return (
    <div
      className="absolute z-10 w-[360px] overflow-y-auto rounded-[22px] border border-border bg-card/92 p-3.5 shadow-[var(--color-shadow-strong)] backdrop-blur-xl"
      style={{
        top: 'calc(var(--window-controls-safe-top) + 2px)',
        right: 'calc(var(--window-controls-safe-right) + 6px)',
        height: 'calc(100% - var(--window-controls-safe-top) - 18px)',
      }}
    >
      {/* Header */}
      <div
        className="mb-4 flex items-center justify-between rounded-[18px] border border-border px-4 py-3.5"
        style={{ background: `linear-gradient(135deg, ${theme}18, rgba(15, 23, 42, 0.84))` }}
      >
        <span className="font-bold text-sm text-foreground flex items-center gap-2">
          {HeaderIcon && <HeaderIcon className="w-4 h-4" />}
          {!HeaderIcon && data.nodeType === 'provider' && <span>☁️</span>}
          {data.label || nodeDisplayName}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg border border-border bg-surface/70"
          onClick={() => setSelectedNodeId(null)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="mb-3">
        <Label className="text-muted text-xs mb-1.5 block">标签</Label>
        <Badge variant="outline" className="border-border bg-surface/80 text-[11px] font-bold tracking-wide text-foreground">
          {nodeTagLabel}
        </Badge>
      </div>

      {/* Type-specific form */}
      {data.nodeType === 'provider' && (
        <ProviderForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'switcher' && (
        <SwitcherForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'poller' && (
        <PollerForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'application' && (
        <ApplicationForm data={data} onUpdate={handleUpdate} />
      )}
    </div>
  );
}
