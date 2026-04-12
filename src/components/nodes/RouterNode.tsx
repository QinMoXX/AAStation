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
  const borderColor = selected ? '#d97706' : '#f59e0b';
  const entryCount = data.entries.length;

  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: '#fffbeb',
        minWidth: 200,
        fontSize: 13,
        position: 'relative',
      }}
    >
      {/* Main input handle on the LEFT side - connects from Provider unified output */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: '#d97706',
          width: 12,
          height: 12,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        title="Main input (from Provider)"
      />

      {/* Output handle on the RIGHT side - connects to Terminal */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          background: '#d97706',
          width: 12,
          height: 12,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        title="Output to Terminal"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>🔀</span>
        <span>{data.label || 'Router'}</span>
      </div>

      {/* Entry count */}
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>
        {entryCount === 0
          ? 'No routing rules'
          : `${entryCount} routing rule${entryCount > 1 ? 's' : ''}`}
      </div>

      {/* Routing entries with LEFT-side input handles (for model-specific routing) */}
      {data.entries.map((entry, index) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 4,
            padding: '4px 8px',
            borderRadius: 4,
            background: '#fef3c7',
            fontSize: 11,
            color: '#92400e',
            position: 'relative',
            borderLeft: '3px solid #f59e0b',
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id={`entry-${entry.id}`}
            style={{
              background: '#f59e0b',
              width: 10,
              height: 10,
              position: 'relative' as const,
              right: 'auto' as const,
              left: 'auto' as const,
              bottom: 'auto' as const,
              top: 'auto' as const,
              marginRight: 8,
              marginLeft: -4,
            }}
            title={`Connect from Provider model (matches: ${entry.pattern || '—'})`}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {entry.label || `Rule #${index + 1}`}
            </div>
            <div style={{ color: '#a16207', fontSize: 10 }}>
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
            marginTop: data.entries.length > 0 ? 8 : 0,
            padding: '4px 8px',
            borderRadius: 4,
            background: '#fde68a',
            fontSize: 11,
            color: '#78350f',
            position: 'relative',
            borderLeft: '3px solid #d97706',
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id="default"
            style={{
              background: '#d97706',
              width: 10,
              height: 10,
              position: 'relative' as const,
              right: 'auto' as const,
              left: 'auto' as const,
              bottom: 'auto' as const,
              top: 'auto' as const,
              marginRight: 8,
              marginLeft: -4,
            }}
            title="Default route (fallback Provider)"
          />
          <div>
            <div style={{ fontWeight: 500 }}>Default</div>
            <div style={{ color: '#a16207', fontSize: 10 }}>
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
            padding: '6px 8px',
            borderRadius: 4,
            background: '#fef3c7',
            fontSize: 10,
            color: '#92400e',
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
