import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { SwitcherNodeData } from '../../types';
import { MIDDLEWARE_CONFIG } from '../../store/flow-store';

/** Match-type display labels. */
const MATCH_TYPE_LABELS: Record<string, string> = {
  path_prefix: 'Path',
  header: 'Header',
  model: 'Model',
};

/** Handle type colors: model=blue, any=orange */
const HANDLE_COLORS: Record<string, string> = {
  model: '#3b82f6', // blue for model-type handles
  any: '#f97316',   // orange for generic handles
};

function SwitcherNode({ data, selected }: NodeProps<SwitcherNodeData>) {
  const middlewareName =
    MIDDLEWARE_CONFIG.find((item) => item.type === data.middlewareType)?.name
    || data.middlewareType
    || 'Middleware';
  const isSwitcher = data.middlewareType === 'switcher';
  const entryCount = data.entries.length;

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #f97316' : '2px solid #e5e7eb',
        background: '#fff',
        minWidth: 220,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
    >
      {/* Main input handle on the LEFT side - connects from Application output */}
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
        title="Input [any] — from Application"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4, color: '#374151' }}>
        <span>🔀</span>
        <span>{data.label || middlewareName}</span>
      </div>

      {/* Entry count */}
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
        {entryCount === 0
          ? '无匹配器'
          : `${entryCount} 个匹配器`}
      </div>

      {/* Matcher entries with RIGHT-side output handles (to Provider model handles) */}
      {isSwitcher && data.entries.map((entry, index, arr) => (
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
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {entry.label || `Matcher #${index + 1}`}
            </div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>
              {MATCH_TYPE_LABELS[entry.matchType] ?? entry.matchType}: {entry.pattern || '—'}
            </div>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id={`entry-${entry.id}`}
            style={{
              background: HANDLE_COLORS[entry.matchType] || HANDLE_COLORS.any,
              width: 12,
              height: 12,
              right: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title={`[${entry.matchType}] Connect to Provider${entry.matchType === 'model' ? ' model' : ''} (matches: ${entry.pattern || '—'})`}
          />
        </div>
      ))}

      {/* Default route with RIGHT-side output handle */}
      {isSwitcher && data.hasDefault && (
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
          <div>
            <div style={{ fontWeight: 500 }}>Default</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>
              Fallback when no matchers match
            </div>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="default"
            style={{
              background: '#f97316',
              width: 12,
              height: 12,
              right: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title="Default [any] — fallback to Provider"
          />
        </div>
      )}

      {/* Hint when no entries */}
      {isSwitcher && entryCount === 0 && !data.hasDefault && (
        <div
          style={{
            marginTop: 8,
            padding: '8px',
            borderRadius: 6,
            background: '#ffffff',
            fontSize: 11,
            color: '#6b7280',
            textAlign: 'center',
          }}
        >
          Add matchers or enable default route
        </div>
      )}
      {!isSwitcher && (
        <div
          style={{
            marginTop: 8,
            padding: '8px',
            borderRadius: 6,
            background: '#ffffff',
            fontSize: 11,
            color: '#6b7280',
            textAlign: 'center',
          }}
        >
          暂不支持的中间件类型：{data.middlewareType}
        </div>
      )}
    </div>
  );
}

export default memo(SwitcherNode);
