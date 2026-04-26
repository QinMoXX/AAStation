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

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 320,
  height: '100%',
  background: '#1f2937',
  borderLeft: '1px solid #374151',
  overflowY: 'auto',
  padding: 16,
  zIndex: 10,
  boxShadow: '-2px 0 8px rgba(0,0,0,0.2)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#9ca3af',
  marginBottom: 8,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#9ca3af',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #374151',
  borderRadius: 6,
  outline: 'none',
  background: '#111827',
  color: '#f9fafb',
  boxSizing: 'border-box' as const,
};

const fieldGap: React.CSSProperties = { marginBottom: 12 };

const tagPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.02em',
  background: '#0f172a',
  color: '#93c5fd',
  border: '1px solid #1d4ed8',
  userSelect: 'none',
};

const tagLabelMap: Record<NodeTag, string> = {
  [NodeTag.Any]: 'ANY',
  [NodeTag.ClaudeCode]: 'CLAUDE_CODE',
  [NodeTag.OpenCode]: 'OPEN_CODE',
  [NodeTag.CodexCli]: 'CODEX_CLI',
};

// ---------------------------------------------------------------------------
// Provider form
// ---------------------------------------------------------------------------

const readonlyInputStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#1f2937',
  color: '#6b7280',
  cursor: 'not-allowed',
};

function ProviderForm({ data, onUpdate }: { data: ProviderNodeData; onUpdate: (patch: Partial<ProviderNodeData>) => void }) {
  // Check if this is a preset node
  const preset = useMemo(
    () => PRESET_PROVIDERS.find((p) => p.id === data.presetId),
    [data.presetId]
  );
  const isPreset = !!preset;

  // Available models from preset (for quick add)
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
    <>
      {/* Preset indicator */}
      {isPreset && (() => {
        const Icon = getProviderIcon(preset.icon);
        return (
          <div
            style={{
              marginBottom: 12,
              padding: '6px 10px',
              background: '#78350f',
              border: '1px solid #92400e',
              borderRadius: 6,
              fontSize: 11,
              color: '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
              {Icon && <Icon style={{ width: 16, height: 16 }} />}
            </span>
            <strong>{preset.name}</strong> 预设供应商，地址不可修改
          </div>
        );
      })()}

      <div style={fieldGap}>
        <label style={labelStyle}>Label</label>
        <input
          style={inputStyle}
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>OpenAI 基础地址</label>
        <input
          style={isPreset ? readonlyInputStyle : inputStyle}
          value={data.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          disabled={isPreset}
        />
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
          需要包含版本路径，例如 `/v1`。用于 OpenAI 兼容请求。
        </div>
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>Anthropic 基础地址 <span style={{ color: '#6b7280', fontWeight: 400 }}>(可选)</span></label>
        <input
          style={isPreset ? readonlyInputStyle : inputStyle}
          value={data.anthropicBaseUrl || ''}
          placeholder="https://open.bigmodel.cn/api/anthropic"
          onChange={(e) => onUpdate({ anthropicBaseUrl: e.target.value || undefined })}
          disabled={isPreset}
        />
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
          不需要版本路径。设置后，Anthropic 兼容请求会直接使用这个地址。
        </div>
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>API 密钥</label>
        <input
          style={inputStyle}
          type="password"
          value={data.apiKey}
          placeholder="sk-..."
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
        />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>Token 预算 <span style={{ color: '#6b7280', fontWeight: 400 }}>(单位：百万)</span></label>
        <input
          style={inputStyle}
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
        />
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
          按百万配置额度，留空表示无限制。
        </div>
      </div>

      {/* Models section */}
      <div style={{ ...fieldGap, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>模型列表</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {isPreset && availablePresetModels.length > 0 && (
            <select
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid #3b82f6',
                borderRadius: 4,
                background: '#1e3a5f',
                color: '#93c5fd',
                cursor: 'pointer',
              }}
              value=""
              onChange={(e) => {
                if (e.target.value) addPresetModel(e.target.value);
              }}
            >
              <option value="">+ 快速添加</option>
              {availablePresetModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.label || m.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={addModel}
            style={{
              fontSize: 12,
              padding: '2px 10px',
              border: '1px solid #3b82f6',
              borderRadius: 4,
              background: '#1e3a5f',
              color: '#93c5fd',
              cursor: 'pointer',
            }}
          >
            + 自定义
          </button>
        </div>
      </div>

      {data.models.length === 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          暂无模型。{isPreset ? '可使用“快速添加”或' : ''}点击“+ 自定义”创建。
        </div>
      )}

      {data.models.map((model, index) => (
        <div
          key={model.id}
          style={{
            marginBottom: 8,
            padding: 8,
            borderRadius: 6,
            border: '1px solid #1e40af',
            background: '#1e3a5f',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd' }}>
              模型 #{index + 1}
            </span>
            <button
              onClick={() => removeModel(model.id)}
              style={{
                fontSize: 11,
                padding: '1px 6px',
                border: '1px solid #7f1d1d',
                borderRadius: 3,
                background: '#7f1d1d',
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>模型名称</label>
            <input
              style={inputStyle}
              value={model.name}
              placeholder="gpt-4o"
              onChange={(e) => updateModel(model.id, { name: e.target.value })}
            />
        </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={model.enabled}
              onChange={(e) => updateModel(model.id, { enabled: e.target.checked })}
            />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>启用</span>
          </div>
        </div>
      ))}
    </>
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
    <>
      <div style={fieldGap}>
        <label style={labelStyle}>Label</label>
        <input
          style={inputStyle}
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      {/* Default route toggle */}
      <div style={{ ...fieldGap, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={data.hasDefault}
          onChange={(e) => onUpdate({ hasDefault: e.target.checked })}
        />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>启用默认路由</span>
      </div>

      {/* Entries section */}
      <div style={{ ...fieldGap, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>匹配器</span>
        <button
          onClick={addEntry}
          style={{
            fontSize: 12,
            padding: '2px 10px',
            border: '1px solid #f59e0b',
            borderRadius: 4,
            background: '#78350f',
            color: '#fbbf24',
            cursor: 'pointer',
          }}
        >
          + 添加
        </button>
      </div>

      {data.entries.length === 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          还没有匹配器。点击"+ 添加"创建一个。
        </div>
      )}

      {data.entries.map((entry, index) => (
        <div
          key={entry.id}
          style={{
            marginBottom: 10,
            padding: 8,
            borderRadius: 6,
            border: '1px solid #92400e',
            background: '#78350f',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24' }}>
              匹配器 #{index + 1}
            </span>
            <button
              onClick={() => removeEntry(entry.id)}
              style={{
                fontSize: 11,
                padding: '1px 6px',
                border: '1px solid #7f1d1d',
                borderRadius: 3,
                background: '#7f1d1d',
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>Label</label>
            <input
              style={inputStyle}
              value={entry.label}
              placeholder="gpt-4o"
              onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>匹配类型</label>
            <select
              style={inputStyle}
              value={entry.matchType}
              onChange={(e) =>
                updateEntry(entry.id, {
                  matchType: e.target.value as SwitcherEntry['matchType'],
                })
              }
            >
              <option value="model">模型</option>
              <option value="path_prefix">路径前缀</option>
              <option value="header">请求头</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>匹配模式</label>
            <input
              style={inputStyle}
              value={entry.pattern}
              placeholder={
                entry.matchType === 'path_prefix'
                  ? '/v1/messages'
                  : entry.matchType === 'header'
                    ? 'X-Custom:value'
                    : 'claude-sonnet-4-20250514'
              }
              onChange={(e) => updateEntry(entry.id, { pattern: e.target.value })}
            />
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Application form
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
    <>
      <div style={fieldGap}>
        <label style={labelStyle}>名称</label>
        <input
          style={inputStyle}
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>策略</label>
        <select
          style={inputStyle}
          value={data.strategy}
          onChange={(e) => onUpdate({ strategy: e.target.value as PollerNodeData['strategy'] })}
        >
          <option value="weighted">加权轮询</option>
          <option value="network_status">网络状态优先</option>
          <option value="token_remaining">剩余额度优先</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>失败阈值</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={data.failureThreshold}
            onChange={(e) => onUpdate({ failureThreshold: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div>
          <label style={labelStyle}>冷却时间(秒)</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={data.cooldownSeconds}
            onChange={(e) => onUpdate({ cooldownSeconds: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div>
          <label style={labelStyle}>探测间隔(秒)</label>
          <input
            style={inputStyle}
            type="number"
            min={5}
            value={data.probeIntervalSeconds}
            onChange={(e) => onUpdate({ probeIntervalSeconds: Math.max(5, Number(e.target.value) || 5) })}
          />
        </div>
      </div>

      <div style={{ ...fieldGap, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={data.hasDefault}
          onChange={(e) => onUpdate({ hasDefault: e.target.checked })}
        />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>启用默认回退</span>
      </div>

      <div style={{ ...fieldGap, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>轮询目标</span>
        <button
          onClick={addTarget}
          style={{
            fontSize: 12,
            padding: '2px 10px',
            border: '1px solid #a855f7',
            borderRadius: 4,
            background: '#581c87',
            color: '#e9d5ff',
            cursor: 'pointer',
          }}
        >
          + 添加
        </button>
      </div>

      {data.targets.length === 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          还没有轮询目标。点击“+ 添加”创建一个。
        </div>
      )}

      {data.targets.map((target, index) => (
        <div
          key={target.id}
          style={{
            marginBottom: 10,
            padding: 8,
            borderRadius: 6,
            border: '1px solid #7e22ce',
            background: '#581c87',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e9d5ff' }}>
              目标 #{index + 1}
            </span>
            <button
              onClick={() => removeTarget(target.id)}
              style={{
                fontSize: 11,
                padding: '1px 6px',
                border: '1px solid #7f1d1d',
                borderRadius: 3,
                background: '#7f1d1d',
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              删除
            </button>
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>名称</label>
            <input
              style={inputStyle}
              value={target.label}
              placeholder="供应商 A"
              onChange={(e) => updateTarget(target.id, { label: e.target.value })}
            />
          </div>

          {showTargetWeight && (
            <div style={{ marginBottom: 6 }}>
              <label style={labelStyle}>权重</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={target.weight}
                onChange={(e) => updateTarget(target.id, { weight: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={target.enabled}
              onChange={(e) => updateTarget(target.id, { enabled: e.target.checked })}
            />
            <span style={{ fontSize: 11, color: '#d8b4fe' }}>启用</span>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Application form
// ---------------------------------------------------------------------------

function ApplicationForm({ data, onUpdate }: { data: ApplicationNodeData; onUpdate: (patch: Partial<ApplicationNodeData>) => void }) {
  const appDefault = APPLICATION_DEFAULTS[data.appType];
  return (
    <>
      <div style={fieldGap}>
        <label style={labelStyle}>Label</label>
        <input
          style={inputStyle}
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>监听端口</label>
        <input
          style={inputStyle}
          type="number"
          value={data.listenPort || ''}
          min={1}
          max={65535}
          placeholder="自动分配"
          onChange={(e) => onUpdate({ listenPort: Number(e.target.value) || 0 })}
        />
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
          0 = 自动从端口范围分配。每个应用节点监听独立端口。
        </div>
      </div>

      {appDefault?.helpText && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.5 }}>
          {appDefault.helpText}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main NodePanel
// ---------------------------------------------------------------------------

export default function NodePanel() {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

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

  // Color header by node type
  const headerColors: Record<string, { bg: string; text: string }> = {
    provider: { bg: '#3b82f6', text: '#fff' },
    switcher: { bg: '#f59e0b', text: '#fff' },
    poller: { bg: '#a855f7', text: '#fff' },
    application: { bg: '#16a34a', text: '#fff' },
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
    <div style={panelStyle}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 6,
          background: theme.bg,
          color: theme.text,
          marginBottom: 16,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          {HeaderIcon && <HeaderIcon style={{ width: 16, height: 16 }} />}
          {!HeaderIcon && data.nodeType === 'provider' && <span>☁️</span>}
          {data.label || nodeDisplayName}
        </span>
        <button
          onClick={() => setSelectedNodeId(null)}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.text,
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 4px',
          }}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>Tag</label>
        <div style={tagPillStyle} title="只读标签，不可修改">
          {nodeTagLabel}
        </div>
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
