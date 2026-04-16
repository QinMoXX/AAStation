import { useCallback, useMemo } from 'react';
import { useFlowStore, PRESET_PROVIDERS } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import type {
  ProviderNodeData,
  SwitcherNodeData,
  ApplicationNodeData,
  AAStationNodeData,
  ProviderModel,
  SwitcherEntry,
} from '../../types';
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

// ---------------------------------------------------------------------------
// Provider form
// ---------------------------------------------------------------------------

const API_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

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
            <strong>{preset.name}</strong> Preset — API Type and Base URL are fixed
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
        <label style={labelStyle}>API Type</label>
        {isPreset ? (
          <input
            style={readonlyInputStyle}
            value={API_TYPE_LABELS[data.apiType] || data.apiType}
            disabled
          />
        ) : (
          <select
            style={inputStyle}
            value={data.apiType}
            onChange={(e) => onUpdate({ apiType: e.target.value as ProviderNodeData['apiType'] })}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        )}
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>Base URL</label>
        <input
          style={isPreset ? readonlyInputStyle : inputStyle}
          value={data.baseUrl}
          placeholder="https://api.openai.com"
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          disabled={isPreset}
        />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>API Key</label>
        <input
          style={inputStyle}
          type="password"
          value={data.apiKey}
          placeholder={data.apiType === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
        />
      </div>

      {/* Models section */}
      <div style={{ ...fieldGap, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>Models</span>
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
              <option value="">+ Quick Add</option>
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
            + Custom
          </button>
        </div>
      </div>

      {data.models.length === 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          No models yet. {isPreset ? 'Use Quick Add or ' : ''}Click "+ Custom" to create one.
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
              Model #{index + 1}
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
            <label style={labelStyle}>Name</label>
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
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Enabled</span>
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
            <label style={labelStyle}>Match Type</label>
            <select
              style={inputStyle}
              value={entry.matchType}
              onChange={(e) =>
                updateEntry(entry.id, {
                  matchType: e.target.value as SwitcherEntry['matchType'],
                })
              }
            >
              <option value="model">Model</option>
              <option value="path_prefix">Path Prefix</option>
              <option value="header">Header</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Pattern</label>
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

function ApplicationForm({ data, onUpdate }: { data: ApplicationNodeData; onUpdate: (patch: Partial<ApplicationNodeData>) => void }) {
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

      {data.appType === 'claude_code' && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.5 }}>
          发布后将自动配置 Claude Code 使用本地代理，API Key 由 Provider 节点提供。
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
  const headerColors: Record<string, { bg: string; text: string; icon: string }> = {
    provider: { bg: '#3b82f6', text: '#fff', icon: '☁️' },
    switcher: { bg: '#f59e0b', text: '#fff', icon: '🔀' },
    application: { bg: '#16a34a', text: '#fff', icon: '🖥️' },
  };
  const theme = headerColors[data.nodeType] ?? headerColors.provider;

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
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {theme.icon} {data.label || data.nodeType}
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

      {/* Type-specific form */}
      {data.nodeType === 'provider' && (
        <ProviderForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'switcher' && (
        <SwitcherForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'application' && (
        <ApplicationForm data={data} onUpdate={handleUpdate} />
      )}
    </div>
  );
}
