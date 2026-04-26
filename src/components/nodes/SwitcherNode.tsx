import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { SwitcherNodeData } from '../../types';
import { MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';

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
  const middlewareConfig = MIDDLEWARE_CONFIG.switcher;
  const middlewareName =
    middlewareConfig?.name
    || 'switcher'
    || 'Middleware';
  const MiddlewareIcon = middlewareConfig?.icon ? getProviderIcon(middlewareConfig.icon) : null;
  const entryCount = data.entries.length;
  const handleBase: React.CSSProperties = {
    width: 12,
    height: 12,
    border: '2px solid #e2e8f0',
    boxShadow: '0 0 0 4px rgba(15, 23, 42, 0.42)',
  };

  return (
    <div
      className={`flow-node${selected ? ' is-selected' : ''}`}
      style={{
        minWidth: 220,
        ['--node-accent' as string]: '#f59e0b',
        ['--node-surface' as string]: 'rgba(15, 23, 42, 0.95)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          ...handleBase,
          background: '#f59e0b',
          top: '50%',
          left: -10,
          transform: 'translateY(-50%)',
        }}
        title="Input [any] — from Application"
      />

      <div className="flow-node-header">
        <div style={{ minWidth: 0 }}>
          <div className="flow-node-title">
            {MiddlewareIcon && <MiddlewareIcon style={{ width: 16, height: 16 }} />}
            <span className="flow-node-title-text">{data.label || middlewareName}</span>
          </div>
          <div className="flow-node-subtitle">
            {entryCount === 0 ? '无匹配器' : `${entryCount} 个匹配器`}
          </div>
        </div>
        <div className="flow-node-badge accent">Router</div>
      </div>

      {data.entries.length > 0 && (
        <div className="flow-node-list">
          {data.entries.map((entry, index) => (
            <div key={entry.id} className="flow-node-entry">
              <div style={{ flex: 1 }}>
                <div className="flow-node-entry-label">{entry.label || `Matcher #${index + 1}`}</div>
                <div className="flow-node-entry-desc">
                  {MATCH_TYPE_LABELS[entry.matchType] ?? entry.matchType}: {entry.pattern || '—'}
                </div>
              </div>
              <span className="flow-node-badge">{MATCH_TYPE_LABELS[entry.matchType] ?? entry.matchType}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`entry-${entry.id}`}
                style={{
                  ...handleBase,
                  background: HANDLE_COLORS[entry.matchType] || HANDLE_COLORS.any,
                  right: -10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title={`[${entry.matchType}] Connect to Provider${entry.matchType === 'model' ? ' model' : ''} (matches: ${entry.pattern || '—'})`}
              />
            </div>
          ))}
          {data.hasDefault && (
            <div className="flow-node-entry">
              <div>
                <div className="flow-node-entry-label">Default</div>
                <div className="flow-node-entry-desc">Fallback when no matchers match</div>
              </div>
              <span className="flow-node-badge accent">Fallback</span>
              <Handle
                type="source"
                position={Position.Right}
                id="default"
                style={{
                  ...handleBase,
                  background: '#f59e0b',
                  right: -10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title="Default [any] — fallback to Provider"
              />
            </div>
          )}
        </div>
      )}

      {entryCount === 0 && data.hasDefault && (
        <div className="flow-node-empty">仅默认路由生效，未命中匹配器时直接回退。</div>
      )}

      {entryCount === 0 && !data.hasDefault && (
        <div className="flow-node-empty">Add matchers or enable default route</div>
      )}
    </div>
  );
}

export default memo(SwitcherNode);
