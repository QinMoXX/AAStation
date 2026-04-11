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
  const ruleCount = data.rules.length;

  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: '#fffbeb',
        minWidth: 160,
        fontSize: 13,
      }}
    >
      {/* Target handle at the top — Router receives from Listener */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        style={{ background: '#d97706', width: 10, height: 10 }}
      />

      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🔀 {data.label || 'Router'}
      </div>

      {/* Rules summary */}
      <div style={{ color: '#64748b', fontSize: 12 }}>
        {ruleCount === 0
          ? 'No rules'
          : `${ruleCount} rule${ruleCount > 1 ? 's' : ''}`}
      </div>

      {/* Show each rule as a small label with a source handle */}
      {data.rules.map((rule) => (
        <div
          key={rule.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: '#fef3c7',
            fontSize: 11,
            color: '#92400e',
            position: 'relative',
          }}
        >
          <span>
            {MATCH_TYPE_LABELS[rule.matchType] ?? rule.matchType}: {rule.pattern || '—'}
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id={`rule-${rule.id}`}
            style={{
              background: '#f59e0b',
              width: 8,
              height: 8,
              position: 'relative' as const,
              right: 'auto' as const,
              left: 'auto' as const,
              bottom: 'auto' as const,
              top: 'auto' as const,
              marginLeft: 6,
            }}
          />
        </div>
      ))}

      {/* Default route source handle */}
      {data.defaultEdgeId !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: '#fde68a',
            fontSize: 11,
            color: '#78350f',
            position: 'relative',
          }}
        >
          <span>Default</span>
          <Handle
            type="source"
            position={Position.Bottom}
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
              marginLeft: 6,
            }}
          />
        </div>
      )}

      {/* Generic source handle for when no specific rules exist yet */}
      {ruleCount === 0 && data.defaultEdgeId === null && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="source"
          style={{ background: '#f59e0b', width: 10, height: 10 }}
        />
      )}
    </div>
  );
}

export default memo(RouterNode);
