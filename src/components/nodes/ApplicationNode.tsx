import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ApplicationNodeData } from '../../types';
import { APPLICATION_DEFAULTS } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';

function ApplicationNode({ data, selected }: NodeProps<ApplicationNodeData>) {
  const appDefault = APPLICATION_DEFAULTS[data.appType];
  const appLabel = appDefault?.displayLabel || data.appType || 'Application';
  const AppIcon = appDefault?.icon ? getProviderIcon(appDefault.icon) : null;
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
        minWidth: 190,
        ['--node-accent' as string]: '#34d399',
        ['--node-surface' as string]: 'rgba(15, 23, 42, 0.95)',
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          ...handleBase,
          background: '#34d399',
          right: -9,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        title="输出"
      />

      <div className="flow-node-header">
        <div style={{ minWidth: 0 }}>
          <div className="flow-node-title">
            {AppIcon && <AppIcon style={{ width: 18, height: 18 }} />}
            <span className="flow-node-title-text">{data.label || appDefault?.defaultNodeLabel || '监听器'}</span>
          </div>
          <div className="flow-node-subtitle">{appLabel}</div>
        </div>
        <div className="flow-node-badge accent">应用</div>
      </div>

      <div className="flow-node-meta">
        <div className="flow-node-badge">{data.appType}</div>
        {data.listenPort > 0 && (
          <div className="flow-node-metric" style={{ fontFamily: 'monospace' }}>
            :{data.listenPort}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ApplicationNode);
