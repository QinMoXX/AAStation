import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { PollerNodeData } from '../../types';
import { MIDDLEWARE_CONFIG } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';

const STRATEGY_LABELS: Record<PollerNodeData['strategy'], string> = {
  round_robin: '加权轮询',
  weighted: '加权轮询',
  network_status: '网络状态优先',
  token_remaining: '剩余额度优先',
};

function usesTargetWeight(strategy: PollerNodeData['strategy']): boolean {
  return strategy === 'weighted' || strategy === 'round_robin';
}

function PollerNode({ data, selected }: NodeProps<PollerNodeData>) {
  const middlewareConfig = MIDDLEWARE_CONFIG.poller;
  const MiddlewareIcon = middlewareConfig?.icon ? getProviderIcon(middlewareConfig.icon) : null;
  const showTargetWeight = usesTargetWeight(data.strategy);
  const handleBase: React.CSSProperties = {
    width: 11,
    height: 11,
    border: '2px solid rgba(226, 232, 240, 0.9)',
    boxShadow: '0 0 0 3px rgba(15, 23, 42, 0.28)',
  };

  return (
    <div
      className={`flow-node${selected ? ' is-selected' : ''}`}
      style={{
        minWidth: 228,
        ['--node-accent' as string]: '#c084fc',
        ['--node-surface' as string]: 'rgba(15, 23, 42, 0.95)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          ...handleBase,
          background: '#a855f7',
          top: '50%',
          left: -9,
          transform: 'translateY(-50%)',
        }}
        title="输入"
      />

      <div className="flow-node-header">
        <div style={{ minWidth: 0 }}>
          <div className="flow-node-title">
            {MiddlewareIcon && <MiddlewareIcon style={{ width: 16, height: 16 }} />}
            <span className="flow-node-title-text">{data.label || middlewareConfig?.name || 'Poller'}</span>
          </div>
          <div className="flow-node-subtitle">
            {STRATEGY_LABELS[data.strategy]}
            {(data.strategy === 'weighted' || data.strategy === 'round_robin') && ` · 每${data.cycleRequests}次切换`}
          </div>
        </div>
        <div className="flow-node-badge accent">轮询</div>
      </div>

      <div className="flow-node-meta">
        <div className="flow-node-metric">
          阈值
          <span className="flow-node-value">{data.failureThreshold}</span>
        </div>
        <div className="flow-node-metric">
          冷却
          <span className="flow-node-value">{data.cooldownSeconds}s</span>
        </div>
        <div className="flow-node-metric">
          探测
          <span className="flow-node-value">{data.probeIntervalSeconds}s</span>
        </div>
      </div>

      {data.targets.length > 0 && (
        <div className="flow-node-list">
          {data.targets.map((target, index) => (
            <div key={target.id} className="flow-node-entry" style={{ opacity: target.enabled ? 1 : 0.58 }}>
              <div style={{ flex: 1 }}>
                <div className="flow-node-entry-label">{target.label || `目标 #${index + 1}`}</div>
                <div className="flow-node-entry-desc">
                  {showTargetWeight ? `运行时动态选择 · 权重 ${target.weight}` : '运行时动态选择'}
                </div>
              </div>
              {showTargetWeight && <span className="flow-node-badge">{target.weight}</span>}
              <Handle
                type="source"
                position={Position.Right}
                id={`target-${target.id}`}
                style={{
                  ...handleBase,
                  background: '#a855f7',
                  right: -9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title="轮询目标"
              />
            </div>
          ))}

          {data.hasDefault && (
            <div className="flow-node-entry">
              <div>
                <div className="flow-node-entry-label">默认回退</div>
                <div className="flow-node-entry-desc">未命中目标时回退</div>
              </div>
              <span className="flow-node-badge accent">默认</span>
              <Handle
                type="source"
                position={Position.Right}
                id="default"
                style={{
                  ...handleBase,
                  background: '#a855f7',
                  right: -9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title="默认回退"
              />
            </div>
          )}
        </div>
      )}

      {data.targets.length === 0 && data.hasDefault && (
        <div className="flow-node-empty">当前仅保留默认回退目标。</div>
      )}

      {data.targets.length === 0 && !data.hasDefault && (
        <div className="flow-node-empty">添加轮询目标后即可连线</div>
      )}
    </div>
  );
}

export default memo(PollerNode);
