import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ProviderNodeData } from '../../types';

const API_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

function ProviderNode({ data, selected }: NodeProps<ProviderNodeData>) {
  const borderColor = selected ? '#3b82f6' : '#60a5fa';
  const hasApiKey = data.apiKey && data.apiKey.length > 0;
  const hasBaseUrl = data.baseUrl && data.baseUrl.length > 0;

  const displayUrl = hasBaseUrl
    ? data.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : 'No URL set';

  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: '#eff6ff',
        minWidth: 180,
        fontSize: 13,
        position: 'relative',
      }}
    >
      {/* Unified output handle - centered on right side of node */}
      <Handle
        type="source"
        position={Position.Right}
        id="unified"
        style={{
          background: '#2563eb',
          width: 12,
          height: 12,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        title="Unified (any model)"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        ☁️ {data.label || 'Provider'}
      </div>

      {/* API Type badge */}
      <div
        style={{
          display: 'inline-block',
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 4,
          background: '#dbeafe',
          color: '#1e40af',
          marginBottom: 4,
        }}
      >
        {API_TYPE_LABELS[data.apiType] || data.apiType}
      </div>

      {/* URL */}
      <div
        style={{
          color: hasBaseUrl ? '#64748b' : '#ef4444',
          fontSize: 11,
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
        }}
        title={data.baseUrl || ''}
      >
        {displayUrl}
      </div>

      {/* API Key status */}
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
        Key:{' '}
        <span style={{ color: hasApiKey ? '#16a34a' : '#ef4444' }}>
          {hasApiKey ? '••••••' : 'Not set'}
        </span>
      </div>

      {/* Model entries with right-side output handles */}
      {data.models.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {data.models.map((model) => (
            <div
              key={model.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 4,
                padding: '4px 6px',
                borderRadius: 4,
                background: model.enabled ? '#dbeafe' : '#f1f5f9',
                fontSize: 11,
                color: model.enabled ? '#1e40af' : '#94a3b8',
                position: 'relative',
              }}
            >
              <span>{model.name || 'Unnamed'}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`model-${model.id}`}
                style={{
                  background: '#3b82f6',
                  width: 10,
                  height: 10,
                  right: -5,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title={`Model: ${model.name || 'Unnamed'}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ProviderNode);
