import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ProviderNodeData } from '../../types';
import { PRESET_PROVIDERS } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';

const API_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

function ProviderNode({ data, selected }: NodeProps<ProviderNodeData>) {
  const hasApiKey = data.apiKey && data.apiKey.length > 0;
  const hasBaseUrl = data.baseUrl && data.baseUrl.length > 0;

  const displayUrl = hasBaseUrl
    ? data.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : 'No URL set';

  // Get preset info if this is a preset node
  const preset = useMemo(
    () => PRESET_PROVIDERS.find((p) => p.id === data.presetId),
    [data.presetId]
  );

  // Get the icon component for the preset
  const IconComponent = useMemo(() => {
    if (preset) {
      return getProviderIcon(preset.icon);
    }
    return null;
  }, [preset]);

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: selected ? '2px solid #f97316' : '2px solid transparent',
        background: '#eff0eb',
        minWidth: 220,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Unified input handle - centered on left side of node */}
      <Handle
        type="target"
        position={Position.Left}
        id="unified"
        style={{
          background: '#f97316',
          width: 12,
          height: 12,
          top: '50%',
          left: -10,
          transform: 'translateY(-50%)',
          border: '3px solid #fff',
        }}
        title="Unified [any] — accepts any connection"
      />

      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', width: 18, height: 18 }}>
          {IconComponent ? (
            <IconComponent style={{ width: 18, height: 18 }} />
          ) : (
            <span>☁️</span>
          )}
        </span>
        <span>{data.label || 'Provider'}</span>
        {preset && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              marginLeft: 'auto',
              padding: '1px 6px',
              background: '#fef3c7',
              color: '#92400e',
              borderRadius: 4,
            }}
          >
            preset
          </span>
        )}
      </div>

      {/* API Type badge */}
      <div
        style={{
          display: 'inline-block',
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 4,
          background: '#ffffff',
          color: '#4b5563',
          marginBottom: 6,
        }}
      >
        {API_TYPE_LABELS[data.apiType] || data.apiType}
      </div>

      {/* URL */}
      <div
        style={{
          color: hasBaseUrl ? '#6b7280' : '#ef4444',
          fontSize: 12,
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
          marginBottom: 4,
        }}
        title={data.baseUrl || ''}
      >
        {displayUrl}
      </div>

      {/* API Key status */}
      <div style={{ color: '#6b7280', fontSize: 12 }}>
        Key:{' '}
        <span style={{ color: hasApiKey ? '#16a34a' : '#ef4444' }}>
          {hasApiKey ? '••••••' : 'Not set'}
        </span>
      </div>

      {/* Model entries with left-side input handles */}
      {data.models.length > 0 && (
        <div style={{ marginTop: 10, marginBottom: -12 }}>
          {data.models.map((model, index) => (
            <div
              key={model.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: index === 0 ? 8 : 6,
                paddingBottom: 6,
                borderTop: index === 0 ? '1px solid #d1d5db' : 'none',
                fontSize: 12,
                color: model.enabled ? '#374151' : '#9ca3af',
                position: 'relative',
                marginLeft: -16,
                marginRight: -16,
                paddingLeft: 16,
                paddingRight: 16,
              }}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`model-${model.id}`}
                style={{
                  background: '#3b82f6',
                  width: 12,
                  height: 12,
                  left: -10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: '3px solid #fff',
                }}
                title={`Model [model]: ${model.name || 'Unnamed'}`}
              />
              <span>{model.name || 'Unnamed'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ProviderNode);
