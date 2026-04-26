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
    : '未设置地址';

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
  const baseHandleStyle: React.CSSProperties = {
    width: 11,
    height: 11,
    border: '2px solid rgba(226, 232, 240, 0.9)',
    boxShadow: '0 0 0 3px rgba(15, 23, 42, 0.28)',
  };

  return (
    <div
      className={`flow-node${selected ? ' is-selected' : ''}`}
      style={{
        minWidth: 252,
        ['--node-accent' as string]: '#60a5fa',
        ['--node-surface' as string]: 'rgba(15, 23, 42, 0.94)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="unified"
        style={{
          ...baseHandleStyle,
          background: '#f59e0b',
          top: '50%',
          left: -9,
          transform: 'translateY(-50%)',
        }}
        title="输入"
      />

      <div className="flow-node-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flow-node-title">
            <span style={{ display: 'flex', alignItems: 'center', width: 18, height: 18 }}>
              {IconComponent ? (
                <IconComponent style={{ width: 18, height: 18 }} />
              ) : (
                <span>☁️</span>
              )}
            </span>
            <span className="flow-node-title-text">{data.label || 'Provider'}</span>
            {preset && <span className="flow-node-badge accent">预设</span>}
          </div>

          <div className="flow-node-badges" style={{ marginTop: 8 }}>
            <div className={`flow-node-badge${hasBaseUrl ? ' accent' : ''}`}>OpenAI</div>
            {hasAnthropicUrl && (
              <div className="flow-node-badge" title={`Anthropic URL: ${data.anthropicBaseUrl}`}>
                Anthropic
              </div>
            )}
          </div>
        </div>

        <div className="flow-node-meta">
          <div className="flow-node-metric" title={`网络状态：${signal.label}`}>
            <div className="flow-node-signal">
              {signalHeights.map((height, index) => (
                <span
                  key={height}
                  style={{
                    height,
                    background: index < signal.bars ? signal.color : 'rgba(148, 163, 184, 0.24)',
                    boxShadow: index < signal.bars ? `0 0 8px ${signal.color}22` : 'none',
                  }}
                />
              ))}
            </div>
            <span>{signal.label}</span>
          </div>

          <div
            className="flow-node-budget"
            title={
              runtimeState
                ? `使用量：${budget.usageText}`
                : fallbackBudgetTokens
                  ? `使用量：0 / ${fallbackBudgetTokens}`
                  : '使用量：无限制'
            }
          >
            <div
              className="flow-node-budget-bar"
              style={{
                width: runtimeState ? `calc(${budget.percent}% - 2px)` : 0,
                minWidth: runtimeState ? 4 : 0,
                background: `linear-gradient(90deg, ${budget.fillColor}CC 0%, ${budget.fillColor} 100%)`,
              }}
            />
            <div
              className="flow-node-budget-label"
              style={{ color: runtimeState ? '#ffffff' : '#94a3b8' }}
            >
              {budget.label}
            </div>
          </div>
        </div>
      </div>

      <div className="flow-node-url" style={{ color: hasBaseUrl ? 'var(--ui-muted)' : 'var(--ui-destructive)' }} title={data.baseUrl || ''}>
        {displayUrl}
      </div>

      <div className="flow-node-meta" style={{ marginTop: 10 }}>
        <div className="flow-node-metric">
          密钥
          <span className="flow-node-value" style={{ color: hasApiKey ? '#34d399' : '#f87171' }}>
            {hasApiKey ? '••••••' : '未设置'}
          </span>
        </div>
        {fallbackBudgetTokens ? (
          <div className="flow-node-metric">
            额度
            <span className="flow-node-value">{formatCompactTokens(fallbackBudgetTokens)}</span>
          </div>
        ) : (
          <div className="flow-node-metric">
            额度
            <span className="flow-node-value">∞</span>
          </div>
        )}
      </div>

      {data.models.length > 0 && (
        <div className="flow-node-list">
          {data.models.map((model, index) => (
            <div
              key={model.id}
              className="flow-node-entry"
              style={{ opacity: model.enabled ? 1 : 0.58 }}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`model-${model.id}`}
                style={{
                  ...baseHandleStyle,
                  background: '#60a5fa',
                  left: -9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
                title={model.name || '未命名模型'}
              />
              <div>
                <div className="flow-node-entry-label">{model.name || '未命名模型'}</div>
                <div className="flow-node-entry-desc">{model.enabled ? '已启用' : '未启用'}</div>
              </div>
              <span className="flow-node-badge">{index + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ProviderNode);
