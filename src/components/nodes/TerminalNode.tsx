import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { TerminalNodeData } from '../../types';

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

function TerminalNode({ data, selected }: NodeProps<TerminalNodeData>) {
  const borderColor = selected ? '#16a34a' : '#4ade80';
  const icon = APP_TYPE_ICONS[data.appType] || '🖥️';
  const appLabel = APP_TYPE_LABELS[data.appType] || data.appType || 'Custom';

  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: '#f0fdf4',
        minWidth: 140,
        fontSize: 13,
        position: 'relative',
      }}
    >
      {/* Input handle on the LEFT side */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ background: '#16a34a', width: 10, height: 10 }}
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {icon} {data.label || 'Terminal'}
      </div>

      {/* App type */}
      <div
        style={{
          display: 'inline-block',
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 4,
          background: '#dcfce7',
          color: '#166534',
        }}
      >
        {appLabel}
      </div>
    </div>
  );
}

export default memo(TerminalNode);
