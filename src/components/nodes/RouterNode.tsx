import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { RouterNodeData } from '../../types';

/** Match-type display labels. */
const MATCH_TYPE_LABELS: Record<string, string> = {
  path_prefix: 'Path',
  header: 'Header',
  model: 'Model',
};

function RouterNode({ data, selected }: NodeProps<RouterNodeData>) {
  const entryCount = data.entries.length;

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #f97316' : '2px solid transparent',
        background: '#e5e7eb',
        minWidth: 220,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Main input handle on the LEFT side - connects from Provider unified output */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: '#f97316',
          width: 12,
          height: 12,
          top: '50%',
          left: -10,
          transform: 'translateY(-50%)',
          border: '3px solid #fff',
        }}
        title="Main input (from Provider)"
      />

      {/* Output handle on the RIGHT side - connects to Terminal */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          background: '#f97316',
          width: 12,
          height: 12,
          top: '50%',
          right: -10,
          transform: 'translateY(-50%)',
          border: '3px solid #fff',
        }}
        title="Output to Terminal"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4, color: '#374151' }}>
        <span>🔀</span>
        <span>{data.label || 'Router'}</span>
      </div>

      {/* Entry count */}
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
        {entryCount === 0
          ? 'No routing rules'
          : `${entryCount} routing rule${entryCount > 1 ? 's' : ''}`}
      </div>

      {/* Routing entries with LEFT-side input handles (for model-specific routing) */}
      {data.entries.map((entry, index, arr) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            paddingTop: index === 0 ? 8 : 6,
            paddingBottom: 6,
            borderTop: index === 0 ? '1px solid #d1d5db' : 'none',
            marginBottom: index === arr.length - 1 && !data.hasDefault ? -12 : 0,
            fontSize: 12,
            color: '#374151',
            position: 'relative',
            marginLeft: -16,
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id={`entry-${entry.id}`}
            style={{
              background: '#f97316',
              width: 12,
              height: 12,
              left: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title={`Connect from Provider model (matches: ${entry.pattern || '—'})`}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {entry.label || `Rule #${index + 1}`}
            </div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>
              {MATCH_TYPE_LABELS[entry.matchType] ?? entry.matchType}: {entry.pattern || '—'}
              {entry.targetModel && (
                <span style={{ color: '#16a34a', marginLeft: 4 }}>
                  → {entry.targetModel}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Default route with LEFT-side input handle */}
      {data.hasDefault && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            paddingTop: data.entries.length > 0 ? 6 : 8,
            paddingBottom: 6,
            borderTop: data.entries.length > 0 ? 'none' : '1px solid #d1d5db',
            marginBottom: -12,
            fontSize: 12,
            color: '#374151',
            position: 'relative',
            marginLeft: -16,
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id="default"
            style={{
              background: '#f97316',
              width: 12,
              height: 12,
              left: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title="Default route (fallback Provider)"
          />
          <div>
            <div style={{ fontWeight: 500 }}>Default</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>
              Fallback when no rules match
            </div>
          </div>
        </div>
      )}

      {/* Hint when no entries */}
      {entryCount === 0 && !data.hasDefault && (
        <div
          style={{
            marginTop: 8,
            padding: '8px',
            borderRadius: 6,
            background: '#d1d5db',
            fontSize: 11,
            color: '#6b7280',
            textAlign: 'center',
          }}
        >
          Add routing rules or enable default route
        </div>
      )}
    </div>
  );
}

export default memo(RouterNode);
