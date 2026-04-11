import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ListenerNodeData } from '../../types';

function ListenerNode({ data, selected }: NodeProps<ListenerNodeData>) {
  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${selected ? '#3b82f6' : '#60a5fa'}`,
        background: '#eff6ff',
        minWidth: 140,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🎧 {data.label || 'Listener'}
      </div>
      <div style={{ color: '#64748b', fontSize: 12 }}>
        {data.bindAddress}:{data.port}
      </div>

      {/* Single source handle at the bottom — Listener is always a source */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        style={{ background: '#3b82f6', width: 10, height: 10 }}
      />
    </div>
  );
}

export default memo(ListenerNode);
