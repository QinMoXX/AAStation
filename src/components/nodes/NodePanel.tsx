import { useCallback } from 'react';
import { useFlowStore } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import type {
  ListenerNodeData,
  RouterNodeData,
  ForwardNodeData,
  AAStationNodeData,
  RoutingRule,
} from '../../types';

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 320,
  height: '100%',
  background: '#fff',
  borderLeft: '1px solid #e2e8f0',
  overflowY: 'auto',
  padding: 16,
  zIndex: 10,
  boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 8,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const fieldGap: React.CSSProperties = { marginBottom: 12 };

// ---------------------------------------------------------------------------
// Listener form
// ---------------------------------------------------------------------------

function ListenerForm({ data, onUpdate }: { data: ListenerNodeData; onUpdate: (patch: Partial<ListenerNodeData>) => void }) {
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
        <label style={labelStyle}>Bind Address</label>
        <input
          style={inputStyle}
          value={data.bindAddress}
          onChange={(e) => onUpdate({ bindAddress: e.target.value })}
        />
      </div>
      <div style={fieldGap}>
        <label style={labelStyle}>Port</label>
        <input
          style={inputStyle}
          type="number"
          value={data.port}
          onChange={(e) => onUpdate({ port: Number(e.target.value) || 0 })}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Router form
// ---------------------------------------------------------------------------

function RouterForm({ data, onUpdate }: { data: RouterNodeData; onUpdate: (patch: Partial<RouterNodeData>) => void }) {
  const addRule = useCallback(() => {
    const newRule: RoutingRule = {
      id: crypto.randomUUID(),
      matchType: 'path_prefix',
      pattern: '',
      targetEdgeId: '',
    };
    onUpdate({ rules: [...data.rules, newRule] });
  }, [data.rules, onUpdate]);

  const removeRule = useCallback(
    (ruleId: string) => {
      onUpdate({ rules: data.rules.filter((r) => r.id !== ruleId) });
    },
    [data.rules, onUpdate],
  );

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<RoutingRule>) => {
      onUpdate({
        rules: data.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
      });
    },
    [data.rules, onUpdate],
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

      <div style={{ ...fieldGap, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>Routing Rules</span>
        <button
          onClick={addRule}
          style={{
            fontSize: 12,
            padding: '2px 10px',
            border: '1px solid #f59e0b',
            borderRadius: 4,
            background: '#fffbeb',
            color: '#92400e',
            cursor: 'pointer',
          }}
        >
          + Add Rule
        </button>
      </div>

      {data.rules.length === 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          No rules yet. Click "Add Rule" to create one.
        </div>
      )}

      {data.rules.map((rule, index) => (
        <div
          key={rule.id}
          style={{
            marginBottom: 10,
            padding: 8,
            borderRadius: 6,
            border: '1px solid #fde68a',
            background: '#fffbeb',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e' }}>
              Rule #{index + 1}
            </span>
            <button
              onClick={() => removeRule(rule.id)}
              style={{
                fontSize: 11,
                padding: '1px 6px',
                border: '1px solid #fca5a5',
                borderRadius: 3,
                background: '#fef2f2',
                color: '#dc2626',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>Match Type</label>
            <select
              style={inputStyle}
              value={rule.matchType}
              onChange={(e) =>
                updateRule(rule.id, {
                  matchType: e.target.value as RoutingRule['matchType'],
                })
              }
            >
              <option value="path_prefix">Path Prefix</option>
              <option value="header">Header</option>
              <option value="model">Model</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Pattern</label>
            <input
              style={inputStyle}
              value={rule.pattern}
              placeholder={
                rule.matchType === 'path_prefix'
                  ? '/v1/messages'
                  : rule.matchType === 'header'
                    ? 'X-Custom:value'
                    : 'claude-sonnet-4-20250514'
              }
              onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
            />
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Forward form
// ---------------------------------------------------------------------------

function ForwardForm({ data, onUpdate }: { data: ForwardNodeData; onUpdate: (patch: Partial<ForwardNodeData>) => void }) {
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
        <label style={labelStyle}>Upstream URL</label>
        <input
          style={inputStyle}
          value={data.upstreamUrl}
          placeholder="https://api.anthropic.com"
          onChange={(e) => onUpdate({ upstreamUrl: e.target.value })}
        />
      </div>
      <div style={fieldGap}>
        <label style={labelStyle}>API Key</label>
        <input
          style={inputStyle}
          type="password"
          value={data.apiKey}
          placeholder="sk-ant-..."
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
        />
      </div>
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
    listener: { bg: '#3b82f6', text: '#fff', icon: '🎧' },
    router: { bg: '#f59e0b', text: '#fff', icon: '🔀' },
    forward: { bg: '#16a34a', text: '#fff', icon: '🚀' },
  };
  const theme = headerColors[data.nodeType] ?? headerColors.listener;

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
      {data.nodeType === 'listener' && (
        <ListenerForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'router' && (
        <RouterForm data={data} onUpdate={handleUpdate} />
      )}
      {data.nodeType === 'forward' && (
        <ForwardForm data={data} onUpdate={handleUpdate} />
      )}
    </div>
  );
}
