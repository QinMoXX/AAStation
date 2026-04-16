import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ApplicationNodeData } from '../../types';

const APP_TYPE_LABELS: Record<string, string> = {
  listener: '自定义监听',
  claude_code: 'Claude Code',
};

const APP_TYPE_ICONS: Record<string, string> = {
  listener: '📡',
  claude_code: '🤖',
};

function ApplicationNode({ data, selected }: NodeProps<ApplicationNodeData>) {
  const icon = APP_TYPE_ICONS[data.appType] || '🖥️';
  const appLabel = APP_TYPE_LABELS[data.appType] || data.appType || 'Application';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #f97316' : '2px solid #e5e7eb',
        background: '#fff',
        minWidth: 180,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
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
        title="Output [any] — connect to Switcher or Provider"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>
        {icon} {data.label || 'Listener'}
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
