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
    width: 12,
    height: 12,
    border: '2px solid #e2e8f0',
    boxShadow: '0 0 0 4px rgba(15, 23, 42, 0.42)',
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
          right: -10,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        title="Output [any] — connect to Switcher or Provider"
      />

      <div className="flow-node-header">
        <div style={{ minWidth: 0 }}>
          <div className="flow-node-title">
            {AppIcon && <AppIcon style={{ width: 18, height: 18 }} />}
            <span className="flow-node-title-text">{data.label || appDefault?.defaultNodeLabel || 'Listener'}</span>
          </div>
          <div className="flow-node-subtitle">{appLabel}</div>
        </div>
        <div className="flow-node-badge accent">App</div>
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
