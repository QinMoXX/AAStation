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

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #a855f7' : '2px solid #e5e7eb',
        background: '#fff',
        minWidth: 220,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: '#a855f7',
          width: 12,
          height: 12,
          top: '50%',
          left: -10,
          transform: 'translateY(-50%)',
          border: '3px solid #fff',
        }}
        title="Input"
      />

      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4, color: '#374151' }}>
        {MiddlewareIcon && <MiddlewareIcon style={{ width: 16, height: 16 }} />}
        <span>{data.label || middlewareConfig?.name || 'Poller'}</span>
      </div>

      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
        {STRATEGY_LABELS[data.strategy]}
      </div>
      <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 8 }}>
        阈值 {data.failureThreshold} / 冷却 {data.cooldownSeconds}s / 探测 {data.probeIntervalSeconds}s
      </div>

      {data.targets.map((target, index, arr) => (
        <div
          key={target.id}
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
            <div style={{ fontWeight: 500 }}>{target.label || `目标 #${index + 1}`}</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>
              {showTargetWeight ? `运行时动态选择 · 权重 ${target.weight}` : '运行时动态选择'}
            </div>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id={`target-${target.id}`}
            style={{
              background: '#a855f7',
              width: 12,
              height: 12,
              right: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title="Poller target"
          />
        </div>
      ))}

      {data.hasDefault && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            paddingTop: data.targets.length > 0 ? 6 : 8,
            paddingBottom: 6,
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
            <div style={{ fontWeight: 500 }}>默认回退</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>未命中目标时回退</div>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="default"
            style={{
              background: '#a855f7',
              width: 12,
              height: 12,
              right: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '3px solid #fff',
            }}
            title="默认目标"
          />
        </div>
      )}

      {data.targets.length === 0 && !data.hasDefault && (
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
          添加轮询目标后即可连线
        </div>
      )}
    </div>
  );
}

export default memo(PollerNode);
