import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ApplicationNodeData } from '../../types';

const APP_TYPE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  openclaw: 'OpenClaw',
  custom: 'Custom',
};

const APP_TYPE_ICONS: Record<string, string> = {
  claude_code: '💻',
  openclaw: '🔧',
  custom: '🖥️',
};

function ApplicationNode({ data, selected }: NodeProps<ApplicationNodeData>) {
  const icon = APP_TYPE_ICONS[data.appType] || '🖥️';
  const appLabel = APP_TYPE_LABELS[data.appType] || data.appType || 'Custom';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #f97316' : '2px solid transparent',
        background: '#eff0eb',
        minWidth: 180,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Output handle on the RIGHT side */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          background: '#f97316',
          width: 12,
          height: 12,
          right: -10,
          top: '50%',
          transform: 'translateY(-50%)',
          border: '3px solid #fff',
        }}
        title="Output to Router or Provider"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>
        {icon} {data.label || 'Application'}
      </div>

      {/* App type */}
      <div
        style={{
          display: 'inline-block',
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 4,
          background: '#ffffff',
          color: '#4b5563',
        }}
      >
        {appLabel}
      </div>
    </div>
  );
}

export default memo(ApplicationNode);
