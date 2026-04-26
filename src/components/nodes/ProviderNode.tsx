import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { ProviderNodeData, ProviderRuntimeState, ProviderRuntimeStatus } from '../../types';
import { PRESET_PROVIDERS } from '../../store/flow-store';
import { getProviderIcon } from '../icons/ProviderIcons';

type ProviderNodeCanvasData = ProviderNodeData & {
  runtimeState?: ProviderRuntimeState | null;
};

function formatCompactTokens(value: number | null | undefined): string {
  if (value == null) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

function networkMeta(status: ProviderRuntimeStatus | undefined) {
  switch (status) {
    case 'healthy':
      return { label: '健康', bars: 4, color: '#22c55e', soft: 'rgba(34, 197, 94, 0.12)' };
    case 'half_open':
      return { label: '半开', bars: 3, color: '#38bdf8', soft: 'rgba(56, 189, 248, 0.12)' };
    case 'degraded':
      return { label: '降级', bars: 2, color: '#f59e0b', soft: 'rgba(245, 158, 11, 0.12)' };
    case 'circuit_open':
      return { label: '熔断', bars: 1, color: '#ef4444', soft: 'rgba(239, 68, 68, 0.12)' };
    default:
      return { label: '未知', bars: 2, color: '#94a3b8', soft: 'rgba(148, 163, 184, 0.10)' };
  }
}

function budgetMeta(
  runtimeState: ProviderRuntimeState | null | undefined,
  fallbackBudgetTokens: number | undefined,
) {
  if (!runtimeState) {
    if (!fallbackBudgetTokens || fallbackBudgetTokens <= 0) {
      return {
        label: '∞',
        percent: 100,
        fillColor: '#3b82f6',
        soft: 'rgba(59, 130, 246, 0.12)',
        usageText: '-- / ∞',
      };
    }
    return {
      label: '0%',
      percent: 0,
      fillColor: '#22c55e',
      soft: 'rgba(34, 197, 94, 0.12)',
      usageText: `0 / ${formatCompactTokens(fallbackBudgetTokens)}`,
    };
  }

  const budgetTokens = runtimeState.budget_tokens;
  const usedTokens =
    runtimeState.used_tokens ??
    (budgetTokens > 0
      ? Math.max(0, budgetTokens - runtimeState.remaining_tokens)
      : 0);

  // Synthetic runtime entries restored from persisted metrics may not carry
  // budget_tokens yet. If the node itself has a configured token limit, prefer
  // that configured budget so the canvas does not incorrectly show infinity.
  if (budgetTokens <= 0 && fallbackBudgetTokens && fallbackBudgetTokens > 0) {
    const usagePercent = (usedTokens / fallbackBudgetTokens) * 100;
    const percent = Math.max(0, Math.min(100, usagePercent));
    const fillColor =
      usagePercent >= 100 ? '#ef4444' : usagePercent >= 70 ? '#f59e0b' : '#22c55e';

    return {
      label: `${Math.round(usagePercent)}%`,
      percent,
      fillColor,
      soft: `${fillColor}22`,
      usageText: `${formatCompactTokens(usedTokens)} / ${formatCompactTokens(fallbackBudgetTokens)}`,
    };
  }

  if (budgetTokens <= 0) {
    return {
      label: '∞',
      percent: 100,
      fillColor: '#3b82f6',
      soft: 'rgba(59, 130, 246, 0.12)',
      usageText: `${formatCompactTokens(usedTokens)} / ∞`,
    };
  }

  const usagePercent = (usedTokens / budgetTokens) * 100;
  const percent = Math.max(0, Math.min(100, usagePercent));
  const fillColor =
    usagePercent >= 100 ? '#ef4444' : usagePercent >= 70 ? '#f59e0b' : '#22c55e';

  return {
    label: `${Math.round(usagePercent)}%`,
    percent,
    fillColor,
    soft: `${fillColor}22`,
    usageText: `${formatCompactTokens(usedTokens)} / ${formatCompactTokens(budgetTokens)}`,
  };
}

function ProviderNode({ data, selected }: NodeProps<ProviderNodeCanvasData>) {
  const hasApiKey = data.apiKey && data.apiKey.length > 0;
  const hasBaseUrl = data.baseUrl && data.baseUrl.length > 0;
  const hasAnthropicUrl = !!(data.anthropicBaseUrl && data.anthropicBaseUrl.length > 0);

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

  const runtimeState = data.runtimeState ?? null;
  const signal = networkMeta(runtimeState?.status);
  const fallbackBudgetTokens =
    data.tokenLimit && data.tokenLimit > 0 ? data.tokenLimit * 1_000_000 : undefined;
  const budget = budgetMeta(runtimeState, fallbackBudgetTokens);
  const signalHeights = [5, 8, 11, 14];

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        border: selected ? '2px solid #f97316' : '1px solid rgba(226, 232, 240, 0.92)',
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        minWidth: 252,
        fontSize: 13,
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: selected ? '0 10px 28px rgba(249,115,22,0.16)' : '0 8px 24px rgba(15,23,42,0.12)',
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

      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: 24,
            height: 18,
            padding: '0 1px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 2,
          }}
          title={`网络状态：${signal.label}`}
        >
          {signalHeights.map((height, index) => (
            <span
              key={height}
              style={{
                width: 2,
                height,
                borderRadius: 999,
                background: index < signal.bars ? signal.color : 'rgba(148, 163, 184, 0.22)',
                boxShadow: index < signal.bars ? `0 0 8px ${signal.color}22` : 'none',
              }}
            />
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            width: 54,
            height: 18,
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.88)',
            border: '1px solid rgba(100, 116, 139, 0.20)',
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.55)',
          }}
          title={
            runtimeState
              ? `使用量：${budget.usageText}`
              : fallbackBudgetTokens
                ? `使用量：0 / ${fallbackBudgetTokens}`
                : '使用量：无限制'
          }
        >
          <div
            style={{
              position: 'absolute',
              inset: 1,
              width: `calc(${budget.percent}% - 2px)`,
              minWidth: runtimeState ? 4 : 0,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${budget.fillColor}CC 0%, ${budget.fillColor} 100%)`,
              transition: 'width 0.25s ease',
            }}
          />
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              color: runtimeState ? '#ffffff' : '#64748b',
              textShadow: runtimeState ? '0 1px 2px rgba(15,23,42,0.25)' : 'none',
              letterSpacing: '0.01em',
            }}
          >
            {budget.label}
          </div>
        </div>
      </div>

      <div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 72 }}>
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
                  fontWeight: 600,
                  padding: '2px 7px',
                  background: 'rgba(245, 158, 11, 0.14)',
                  color: '#b45309',
                  borderRadius: 999,
                }}
              >
                预设
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-block',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: hasBaseUrl ? 'rgba(59, 130, 246, 0.10)' : 'rgba(239, 68, 68, 0.10)',
                color: hasBaseUrl ? '#1d4ed8' : '#b91c1c',
              }}
            >
              OpenAI
            </div>
            {hasAnthropicUrl && (
              <div
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#b45309',
                }}
                title={`Anthropic URL: ${data.anthropicBaseUrl}`}
              >
                Anthropic
              </div>
            )}
          </div>

          <div
            style={{
              color: hasBaseUrl ? '#64748b' : '#ef4444',
              fontSize: 12,
              maxWidth: 170,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
              marginBottom: 6,
            }}
            title={data.baseUrl || ''}
          >
            {displayUrl}
          </div>

          <div style={{ color: '#64748b', fontSize: 12 }}>
            密钥:
            {' '}
            <span style={{ color: hasApiKey ? '#16a34a' : '#ef4444' }}>
              {hasApiKey ? '••••••' : '未设置'}
            </span>
          </div>
        </div>
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
