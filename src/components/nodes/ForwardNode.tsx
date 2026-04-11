import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ForwardNodeData } from '../../types';

function ForwardNode({ data, selected }: NodeProps<ForwardNodeData>) {
  const borderColor = selected ? '#16a34a' : '#4ade80';
  const hasApiKey = data.apiKey && data.apiKey.length > 0;
  const hasUpstreamUrl = data.upstreamUrl && data.upstreamUrl.length > 0;

  /** Truncate URL for display. */
  const displayUrl = hasUpstreamUrl
    ? data.upstreamUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : 'No upstream set';

  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: '#f0fdf4',
        minWidth: 150,
        fontSize: 13,
      }}
    >
      {/* Target handle at the top — Forward receives from Listener or Router */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        style={{ background: '#16a34a', width: 10, height: 10 }}
      />

      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🚀 {data.label || 'Forward'}
      </div>

      {/* Upstream URL */}
      <div
        style={{
          color: hasUpstreamUrl ? '#64748b' : '#ef4444',
          fontSize: 11,
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
        }}
        title={data.upstreamUrl || ''}
      >
        {displayUrl}
      </div>

      {/* API Key status indicator */}
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
        API Key:{' '}
        <span style={{ color: hasApiKey ? '#16a34a' : '#ef4444' }}>
          {hasApiKey ? '••••••' : 'Not set'}
        </span>
      </div>
    </div>
  );
}

export default memo(ForwardNode);
