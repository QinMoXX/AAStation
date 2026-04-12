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
        minWidth: 180,
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🔀 {data.label || 'Router'}
      </div>

      {/* Entry count */}
      <div style={{ color: '#64748b', fontSize: 12 }}>
        {entryCount === 0
          ? 'No entries'
          : `${entryCount} entr${entryCount > 1 ? 'ies' : 'y'}`}
      </div>

      {/* Entry input handles on the LEFT side */}
      {data.entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: '#fef3c7',
            fontSize: 11,
            color: '#92400e',
            position: 'relative',
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id={`entry-${entry.id}`}
            style={{
              background: '#f59e0b',
              width: 8,
              height: 8,
              position: 'relative' as const,
              right: 'auto' as const,
              left: 'auto' as const,
              bottom: 'auto' as const,
              top: 'auto' as const,
              marginRight: 6,
            }}
          />
          <span>
            {MATCH_TYPE_LABELS[entry.matchType] ?? entry.matchType}: {entry.pattern || entry.label || '—'}
          </span>
        </div>
      ))}

      {/* Default input handle on the LEFT side */}
      {data.hasDefault && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: '#fde68a',
            fontSize: 11,
            color: '#78350f',
            position: 'relative',
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id="default"
            style={{
              background: '#d97706',
              width: 8,
              height: 8,
              position: 'relative' as const,
              right: 'auto' as const,
              left: 'auto' as const,
              bottom: 'auto' as const,
              top: 'auto' as const,
              marginRight: 6,
            }}
          />
          <span>Default</span>
        </div>
      )}

      {/* Unified output handle on the RIGHT side */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginTop: 6,
          position: 'relative',
        }}
      >
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          style={{
            background: '#f59e0b',
            width: 10,
            height: 10,
          }}
        />
      </div>

      {/* Fallback: when no entries and no default, show a generic target handle */}
      {entryCount === 0 && !data.hasDefault && (
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          style={{ background: '#f59e0b', width: 10, height: 10 }}
        />
      )}
    </div>
  );
}

export default memo(RouterNode);
