import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProxyMetrics } from '../../lib/tauri-api';
import { useAppStore } from '../../store/app-store';
import type {
  PollerRuntimeState,
  ProviderRuntimeState,
  ProxyMetricsEntitySummary,
  ProxyMetricsSnapshot,
  ProxyMetricsSummary,
  ProxyRequestMetric,
} from '../../types';

const POLL_INTERVAL_MS = 4000;
type TimeRangeKey = '24h' | '1w' | '1M';

const TIME_RANGE_OPTIONS: { key: TimeRangeKey; label: string; minutes: number; buckets: number }[] = [
  { key: '24h', label: '24 小时', minutes: 24 * 60, buckets: 12 },
  { key: '1w', label: '7 天', minutes: 7 * 24 * 60, buckets: 14 },
  { key: '1M', label: '30 天', minutes: 30 * 24 * 60, buckets: 15 },
];

const EMPTY_SUMMARY: ProxyMetricsSummary = {
  requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  streamed_requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  total_latency_ms: 0,
  last_request_at: null,
};

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
};

const containerStyle: React.CSSProperties = {
  padding: '42px 28px 36px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const cardStyle: React.CSSProperties = {};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatNumber(value);
}

function formatMillions(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
  return formatNumber(value);
}

function providerUsagePercent(provider: ProviderRuntimeState): number | null {
  if (provider.budget_tokens <= 0) return null;
  return (provider.used_tokens / provider.budget_tokens) * 100;
}

function usageColor(percent: number | null): string {
  if (percent == null) return '#60a5fa';
  if (percent >= 100) return '#f87171';
  if (percent >= 70) return '#fbbf24';
  return '#4ade80';
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function averageLatency(summary: ProxyMetricsSummary): number {
  if (summary.requests === 0) return 0;
  return Math.round(summary.total_latency_ms / summary.requests);
}

function successRate(summary: ProxyMetricsSummary): number {
  if (summary.requests === 0) return 0;
  return (summary.successful_requests / summary.requests) * 100;
}

function mergeSummary(target: ProxyMetricsSummary, source: ProxyMetricsSummary): ProxyMetricsSummary {
  const nextLast =
    !target.last_request_at || (source.last_request_at && source.last_request_at > target.last_request_at)
      ? source.last_request_at
      : target.last_request_at;

  return {
    requests: target.requests + source.requests,
    successful_requests: target.successful_requests + source.successful_requests,
    failed_requests: target.failed_requests + source.failed_requests,
    streamed_requests: target.streamed_requests + source.streamed_requests,
    input_tokens: target.input_tokens + source.input_tokens,
    output_tokens: target.output_tokens + source.output_tokens,
    total_tokens: target.total_tokens + source.total_tokens,
    total_latency_ms: target.total_latency_ms + source.total_latency_ms,
    last_request_at: nextLast ?? null,
  };
}

function summarizeRequests(requests: ProxyRequestMetric[]): ProxyMetricsSummary {
  return requests.reduce((summary, request) => {
    const requestSummary: ProxyMetricsSummary = {
      requests: 1,
      successful_requests: request.success ? 1 : 0,
      failed_requests: request.success ? 0 : 1,
      streamed_requests: request.streamed ? 1 : 0,
      input_tokens: request.input_tokens,
      output_tokens: request.output_tokens,
      total_tokens: request.total_tokens,
      total_latency_ms: request.duration_ms,
      last_request_at: request.completed_at,
    };
    return mergeSummary(summary, requestSummary);
  }, EMPTY_SUMMARY);
}

function buildSummaryFromEntity(entity?: ProxyMetricsEntitySummary | null): ProxyMetricsSummary {
  if (!entity) return { ...EMPTY_SUMMARY };
  return {
    requests: entity.requests,
    successful_requests: entity.successful_requests,
    failed_requests: entity.failed_requests,
    streamed_requests: entity.streamed_requests,
    input_tokens: entity.input_tokens,
    output_tokens: entity.output_tokens,
    total_tokens: entity.total_tokens,
    total_latency_ms: entity.total_latency_ms,
    last_request_at: entity.last_request_at,
  };
}

function groupByApplication(requests: ProxyRequestMetric[]): ProxyMetricsEntitySummary[] {
  const grouped = new Map<string, ProxyMetricsEntitySummary>();
  requests.forEach((item) => {
    const current = grouped.get(item.app_id);
    const summary = summarizeRequests([item]);
    if (current) {
      const merged = mergeSummary(buildSummaryFromEntity(current), summary);
      current.requests = merged.requests;
      current.successful_requests = merged.successful_requests;
      current.failed_requests = merged.failed_requests;
      current.streamed_requests = merged.streamed_requests;
      current.input_tokens = merged.input_tokens;
      current.output_tokens = merged.output_tokens;
      current.total_tokens = merged.total_tokens;
      current.total_latency_ms = merged.total_latency_ms;
      current.last_request_at = merged.last_request_at;
      return;
    }
    grouped.set(item.app_id, {
      id: item.app_id,
      label: item.app_label,
      ...summary,
    });
  });

  return Array.from(grouped.values()).sort((a, b) => b.requests - a.requests);
}

function groupByProvider(requests: ProxyRequestMetric[]): ProxyMetricsEntitySummary[] {
  const grouped = new Map<string, ProxyMetricsEntitySummary>();
  requests.forEach((item) => {
    const current = grouped.get(item.provider_id);
    const summary = summarizeRequests([item]);
    if (current) {
      const merged = mergeSummary(buildSummaryFromEntity(current), summary);
      current.requests = merged.requests;
      current.successful_requests = merged.successful_requests;
      current.failed_requests = merged.failed_requests;
      current.streamed_requests = merged.streamed_requests;
      current.input_tokens = merged.input_tokens;
      current.output_tokens = merged.output_tokens;
      current.total_tokens = merged.total_tokens;
      current.total_latency_ms = merged.total_latency_ms;
      current.last_request_at = merged.last_request_at;
      return;
    }
    grouped.set(item.provider_id, {
      id: item.provider_id,
      label: item.provider_label,
      ...summary,
    });
  });

  return Array.from(grouped.values()).sort((a, b) => b.requests - a.requests);
}

function getTimeRangeConfig(key: TimeRangeKey) {
  return TIME_RANGE_OPTIONS.find((item) => item.key === key) ?? TIME_RANGE_OPTIONS[1];
}

function isRequestInTimeRange(request: ProxyRequestMetric, rangeKey: TimeRangeKey): boolean {
  const completedAt = new Date(request.completed_at).getTime();
  if (Number.isNaN(completedAt)) return false;
  const config = getTimeRangeConfig(rangeKey);
  return completedAt >= Date.now() - config.minutes * 60 * 1000;
}

function buildTrendBuckets(requests: ProxyRequestMetric[], rangeKey: TimeRangeKey) {
  const config = getTimeRangeConfig(rangeKey);
  const now = Date.now();
  const totalMs = config.minutes * 60 * 1000;
  const bucketMs = totalMs / config.buckets;
  const start = now - totalMs;
  const buckets = Array.from({ length: config.buckets }, (_, index) => {
    const bucketStart = start + index * bucketMs;
    const labelDate = new Date(bucketStart);
    return {
      label:
        rangeKey === '1M'
          ? labelDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' })
          : rangeKey === '1w'
          ? labelDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
          : labelDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' }),
      requests: 0,
      tokens: 0,
    };
  });

  requests.forEach((request) => {
    const time = new Date(request.completed_at).getTime();
    if (Number.isNaN(time) || time < start) return;
    const index = Math.min(
      config.buckets - 1,
      Math.floor((time - start) / bucketMs)
    );
    if (index >= 0 && buckets[index]) {
      buckets[index].requests += 1;
      buckets[index].tokens += request.total_tokens;
    }
  });

  return buckets;
}

function exportCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
) {
  const escapeCell = (value: string | number | boolean | null | undefined) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

function RequestDetailDrawer({
  request,
  onClose,
}: {
  request: ProxyRequestMetric | null;
  onClose: () => void;
}) {
  if (!request) return null;

  const drawerRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '120px 1fr',
    gap: 12,
    padding: '12px 0',
    borderTop: '1px solid rgba(148, 163, 184, 0.08)',
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 30,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 520,
          maxWidth: '100vw',
          height: '100vh',
          background: '#0d0f14',
          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '-24px 0 48px rgba(0, 0, 0, 0.35)',
          zIndex: 31,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '20px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>请求详情</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{request.id}</div>
          </div>
          <button
            onClick={onClose}
            className="ui-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '0 22px 24px', overflow: 'auto' }}>
          <div style={{ ...drawerRowStyle, borderTop: 'none' }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>应用 / 端口</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}>{request.app_label} / :{request.listen_port}</div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>供应商</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}>{request.provider_label}</div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>完整路径</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, wordBreak: 'break-all' }}>
              {request.method} {request.path}
            </div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>协议 / 状态</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}>
              {request.protocol} / {request.status_code ?? '-'} / {request.streamed ? '流式' : '标准'}
            </div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>模型映射</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.7 }}>
              <div>请求模型: {request.request_model || '-'}</div>
              <div>路由目标模型: {request.target_model || 'keep'}</div>
              <div>响应模型: {request.response_model || '-'}</div>
            </div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Token</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.7 }}>
              <div>输入: {formatNumber(request.input_tokens)}</div>
              <div>输出: {formatNumber(request.output_tokens)}</div>
              <div>总计: {formatNumber(request.total_tokens)}</div>
            </div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>耗时</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}>{formatDuration(request.duration_ms)}</div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>时间</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.7 }}>
              <div>开始: {formatDateTime(request.started_at)}</div>
              <div>结束: {formatDateTime(request.completed_at)}</div>
            </div>
          </div>
          <div style={drawerRowStyle}>
            <div style={{ color: '#64748b', fontSize: 12 }}>错误信息</div>
            <div
              style={{
                color: request.error ? '#fca5a5' : '#94a3b8',
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {request.error || '无'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  title,
  value,
  subValue,
  accent,
}: {
  title: string;
  value: string;
  subValue: string;
  accent: string;
}) {
  return (
    <div
      className="ui-card"
      style={{
        padding: 20,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -24,
          top: -24,
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: accent,
          filter: 'blur(26px)',
          opacity: 0.38,
        }}
      />
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: '#f8fafc', marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1' }}>{subValue}</div>
    </div>
  );
}

function BarList({
  title,
  rows,
  metricLabel,
  accent,
}: {
  title: string;
  rows: ProxyMetricsEntitySummary[];
  metricLabel: 'requests' | 'total_tokens';
  accent: string;
}) {
  const maxValue = rows.length > 0 ? Math.max(...rows.map((item) => item[metricLabel])) : 1;

  return (
    <div className="ui-card" style={{ ...cardStyle, padding: 20, minHeight: 300 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#f8fafc', marginBottom: 18 }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>暂无数据</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.slice(0, 6).map((row) => (
            <div key={row.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.label}
                </span>
                <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {metricLabel === 'requests'
                    ? `${formatNumber(row.requests)} 次`
                    : `${formatCompact(row.total_tokens)} Tokens`}
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${maxValue === 0 ? 0 : (row[metricLabel] / maxValue) * 100}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: accent,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendChart({
  title,
  subtitle,
  buckets,
  color,
  shadowColor,
  accessor,
}: {
  title: string;
  subtitle: string;
  buckets: { label: string; requests: number; tokens: number }[];
  color: string;
  shadowColor: string;
  accessor: (item: { label: string; requests: number; tokens: number }) => number;
}) {
  const max = Math.max(1, ...buckets.map(accessor));

  return (
    <div className="ui-card" style={{ ...cardStyle, padding: 20, minHeight: 280 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#f8fafc' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{subtitle}</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
          gap: 10,
          alignItems: 'end',
          height: 180,
          marginTop: 22,
        }}
      >
        {buckets.map((bucket) => {
          const value = accessor(bucket);
          return (
            <div
              key={bucket.label}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
            >
              <div style={{ fontSize: 11, color: '#cbd5e1', minHeight: 16 }}>
                {value > 0 ? formatCompact(value) : ''}
              </div>
              <div
                style={{
                  width: '100%',
                  maxWidth: 32,
                  height: `${(value / max) * 130 + (value > 0 ? 10 : 0)}px`,
                  minHeight: value > 0 ? 10 : 4,
                  borderRadius: 12,
                  background: color,
                  boxShadow: `0 8px 24px ${shadowColor}`,
                }}
              />
              <div style={{ fontSize: 11, color: '#64748b' }}>{bucket.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeStatusCard({
  providers,
  pollers,
}: {
  providers: ProviderRuntimeState[];
  pollers: PollerRuntimeState[];
}) {
  const [collapsed, setCollapsed] = useState(true);
  const statusColor = (status: ProviderRuntimeState['status']) => {
    switch (status) {
      case 'healthy': return '#22c55e';
      case 'degraded': return '#f59e0b';
      case 'circuit_open': return '#ef4444';
      default: return '#64748b';
    }
  };

  const statusLabel = (status: ProviderRuntimeState['status']) => {
    switch (status) {
      case 'healthy': return '健康';
      case 'half_open': return '半开恢复';
      case 'degraded': return '降级';
      case 'circuit_open': return '熔断中';
      default: return '未知';
    }
  };

  const pollerStrategyLabel = (strategy: PollerRuntimeState['strategy']) => {
    switch (strategy) {
      case 'weighted': return '加权轮询';
      case 'network_status': return '网络状态优先';
      case 'token_remaining': return '剩余额度优先';
      default: return strategy;
    }
  };

  const showTargetWeight = (strategy: PollerRuntimeState['strategy']) => strategy === 'weighted';

  return (
    <div className="ui-card" style={{ ...cardStyle, padding: 20 }}>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          marginBottom: collapsed ? 0 : 18,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: '#f8fafc' }}>
          运行时状态
        </span>
        <span
          style={{
            fontSize: 20,
            color: '#94a3b8',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.2s ease',
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>供应商健康 / 熔断</div>
          {providers.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>暂无供应商运行态数据</div>}
          {providers.slice(0, 8).map((provider) => (
            <div
              key={provider.provider_id}
              style={{
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: '12px 14px',
                background: 'rgba(15, 23, 42, 0.55)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{provider.provider_label}</div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: statusColor(provider.status),
                    background: `${statusColor(provider.status)}22`,
                    border: `1px solid ${statusColor(provider.status)}55`,
                    borderRadius: 999,
                    padding: '2px 8px',
                  }}
                >
                  {statusLabel(provider.status)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
                <div>连续失败: {formatNumber(provider.consecutive_failures)}</div>
                <div style={{ color: usageColor(providerUsagePercent(provider)) }}>
                  使用率: {providerUsagePercent(provider) == null ? '无限制' : formatPercent(providerUsagePercent(provider) ?? 0)}
                </div>
                <div>已使用: {formatMillions(provider.used_tokens)}</div>
                <div>预算: {provider.budget_tokens > 0 ? formatMillions(provider.budget_tokens) : '无限制'}</div>
                <div>阈值 / 冷却: {provider.failure_threshold} / {provider.cooldown_seconds}s</div>
                <div>探测间隔: {provider.probe_interval_seconds}s</div>
                <div>半开开始: {formatDateTime(provider.half_open_since)}</div>
                <div>恢复试探: {formatNumber(provider.recovery_attempts)}</div>
                <div>探测时间: {formatDateTime(provider.last_probe_at)}</div>
                <div>熔断至: {formatDateTime(provider.circuit_open_until)}</div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>熔断时间线</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {provider.timeline.length === 0 && (
                    <div style={{ fontSize: 11, color: '#64748b' }}>暂无熔断事件</div>
                  )}
                  {provider.timeline.slice(-4).reverse().map((event) => (
                    <div key={`${provider.provider_id}-${event.at}-${event.kind}`} style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 }}>
                      <span style={{ color: '#94a3b8' }}>{formatDateTime(event.at)}</span>
                      {' · '}
                      <span>{event.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
              {provider.last_error && (
                <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>
                  最近错误: {provider.last_error}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>轮询节点最近选路</div>
          {pollers.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>暂无轮询节点运行态数据</div>}
          {pollers.slice(0, 8).map((poller) => (
            <div
              key={poller.poller_id}
              style={{
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: '12px 14px',
                background: 'rgba(15, 23, 42, 0.55)',
              }}
            >
              <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{poller.poller_label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
                <div>策略: {pollerStrategyLabel(poller.strategy)}</div>
                <div>游标: {poller.cursor}</div>
                <div>阈值 / 冷却: {poller.failure_threshold} / {poller.cooldown_seconds}s</div>
                <div>探测间隔: {poller.probe_interval_seconds}s</div>
                <div>总选路: {formatNumber(poller.total_selections)}</div>
                <div>最近目标: {poller.last_selected_target || '-'}</div>
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 8, lineHeight: 1.5 }}>
                最近供应商: {poller.last_selected_provider_label || '-'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                最近时间: {formatDateTime(poller.last_selected_at)}
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                  {showTargetWeight(poller.strategy) ? '权重命中统计' : '目标命中统计'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {poller.target_stats.length === 0 && (
                    <div style={{ fontSize: 11, color: '#64748b' }}>暂无目标命中数据</div>
                  )}
                  {poller.target_stats.slice(0, 4).map((stat) => (
                    <div
                      key={`${poller.poller_id}-${stat.target_id}`}
                      style={{
                        fontSize: 11,
                        color: '#cbd5e1',
                        display: 'grid',
                        gridTemplateColumns: showTargetWeight(poller.strategy) ? '1fr auto auto' : '1fr auto',
                        gap: 8,
                      }}
                    >
                      <span>{stat.target_label || stat.target_id}</span>
                      {showTargetWeight(poller.strategy) && (
                        <span style={{ color: '#a78bfa' }}>权重 {stat.configured_weight}</span>
                      )}
                      <span style={{ color: '#94a3b8' }}>命中 {formatNumber(stat.hits)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const [snapshot, setSnapshot] = useState<ProxyMetricsSnapshot | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('24h');
  const [selectedApp, setSelectedApp] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState<ProxyRequestMetric | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }
    try {
      const next = await getProxyMetrics();
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (!silent) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    const timer = window.setInterval(() => {
      loadMetrics(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadMetrics]);

  const timeFilteredRequests = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.recent_requests.filter((item) => isRequestInTimeRange(item, timeRange));
  }, [snapshot, timeRange]);

  const filteredRequests = useMemo(() => {
    return timeFilteredRequests.filter((item) => {
      if (selectedApp !== 'all' && item.app_id !== selectedApp) return false;
      if (selectedProvider !== 'all' && item.provider_id !== selectedProvider) return false;
      return true;
    });
  }, [timeFilteredRequests, selectedApp, selectedProvider]);

  const filteredSummary = useMemo(
    () => summarizeRequests(filteredRequests),
    [filteredRequests]
  );

  const applicationRows = useMemo(() => {
    const source = selectedProvider === 'all'
      ? timeFilteredRequests
      : timeFilteredRequests.filter((item) => item.provider_id === selectedProvider);
    return groupByApplication(source);
  }, [timeFilteredRequests, selectedProvider]);

  const providerRows = useMemo(() => {
    const source = selectedApp === 'all'
      ? timeFilteredRequests
      : timeFilteredRequests.filter((item) => item.app_id === selectedApp);
    return groupByProvider(source);
  }, [timeFilteredRequests, selectedApp]);

  const trendBuckets = useMemo(
    () => buildTrendBuckets(filteredRequests, timeRange),
    [filteredRequests, timeRange]
  );

  const selectedTimeRange = useMemo(() => getTimeRangeConfig(timeRange), [timeRange]);

  const success = successRate(filteredSummary);
  const avgLatency = averageLatency(filteredSummary);
  const streamRatio =
    filteredSummary.requests === 0
      ? 0
      : (filteredSummary.streamed_requests / filteredSummary.requests) * 100;

  const handleExportRequests = useCallback(() => {
    exportCsv(
      `aastation-requests-${timeRange}.csv`,
      [
        '请求ID',
        '完成时间',
        '应用',
        '端口',
        '供应商',
        '方法',
        '路径',
        '协议',
        '请求模型',
        '路由模型',
        '响应模型',
        '状态码',
        '成功',
        '流式',
        '输入Token',
        '输出Token',
        '总Token',
        '耗时ms',
        '错误信息',
      ],
      filteredRequests.map((item) => [
        item.id,
        item.completed_at,
        item.app_label,
        item.listen_port,
        item.provider_label,
        item.method,
        item.path,
        item.protocol,
        item.request_model,
        item.target_model,
        item.response_model,
        item.status_code,
        item.success,
        item.streamed,
        item.input_tokens,
        item.output_tokens,
        item.total_tokens,
        item.duration_ms,
        item.error,
      ])
    );
  }, [filteredRequests, timeRange]);

  const handleExportTrend = useCallback(() => {
    exportCsv(
      `aastation-trend-${timeRange}.csv`,
      ['时间桶', '请求数', 'Token'],
      trendBuckets.map((item) => [item.label, item.requests, item.tokens])
    );
  }, [timeRange, trendBuckets]);

  return (
    <div style={pageStyle} className="ui-page ui-accent-monitor">
      <div style={containerStyle}>
        <div
          className="ui-card"
          style={{
            padding: 24,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 280 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#f8fafc', marginBottom: 10 }}>
              API 监控中心
            </div>
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>
              Token 由本地估算，和实际计费可能有偏差。
            </div>
            <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7, maxWidth: 680 }}>
              实时观察本地代理收到的 API 请求次数、Token 使用量、请求耗时与最近调用明细。
              可按应用和供应商筛选，快速定位流量热点与异常来源。
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))',
              gap: 12,
              minWidth: 320,
              flex: 1,
            }}
          >
            <div
              className="ui-card"
              style={{
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--ui-muted)', marginBottom: 6 }}>代理状态</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>
                {proxyStatus.running ? '运行中' : '未启动'}
              </div>
              <div style={{ fontSize: 12, color: proxyStatus.running ? '#86efac' : 'var(--ui-dim)', marginTop: 8 }}>
                {proxyStatus.running
                  ? `监听端口 ${proxyStatus.listen_ports.join(', ')}`
                  : '启动代理后开始采集请求数据'}
              </div>
            </div>
            <div
              className="ui-card"
              style={{
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--ui-muted)', marginBottom: 6 }}>最近刷新</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>
                {snapshot ? formatDateTime(snapshot.generated_at) : '--'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ui-dim)', marginTop: 8 }}>
                {refreshing ? '同步中...' : `每 ${POLL_INTERVAL_MS / 1000} 秒自动刷新`}
              </div>
            </div>
          </div>
        </div>

        <div
          className="ui-card"
          style={{
            padding: 18,
            display: 'flex',
            gap: 14,
            alignItems: 'end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>时间范围</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TIME_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setTimeRange(option.key)}
                  className={timeRange === option.key ? 'ui-btn ui-btn-active' : 'ui-btn'}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>应用筛选</div>
            <select
              value={selectedApp}
              onChange={(e) => setSelectedApp(e.target.value)}
              className="ui-select"
              style={{
                width: '100%',
              }}
            >
              <option value="all">全部应用</option>
              {(snapshot?.applications ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>供应商筛选</div>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="ui-select"
              style={{
                width: '100%',
              }}
            >
              <option value="all">全部供应商</option>
              {(snapshot?.providers ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => {
              setTimeRange('24h');
              setSelectedApp('all');
              setSelectedProvider('all');
            }}
            className="ui-btn"
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            重置筛选
          </button>

          <button
            onClick={() => loadMetrics()}
            disabled={refreshing}
            className="ui-btn ui-btn-primary"
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              cursor: refreshing ? 'not-allowed' : 'pointer',
            }}
          >
            {refreshing ? '刷新中...' : '立即刷新'}
          </button>

          {error && (
            <div style={{ fontSize: 12, color: '#fca5a5' }}>
              数据拉取失败: {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          <SummaryCard
            title="总调用次数"
            value={formatNumber(filteredSummary.requests)}
            subValue={`失败 ${formatNumber(filteredSummary.failed_requests)} 次`}
            accent="var(--ui-monitor-summary-1)"
          />
          <SummaryCard
            title="成功率"
            value={formatPercent(success)}
            subValue={`成功 ${formatNumber(filteredSummary.successful_requests)} 次`}
            accent="var(--ui-monitor-summary-2)"
          />
          <SummaryCard
            title="Token 使用量"
            value={formatCompact(filteredSummary.total_tokens)}
            subValue={`输入 ${formatCompact(filteredSummary.input_tokens)} · 输出 ${formatCompact(filteredSummary.output_tokens)}`}
            accent="var(--ui-monitor-summary-3)"
          />
          <SummaryCard
            title="平均耗时"
            value={formatDuration(avgLatency)}
            subValue={`流式请求占比 ${formatPercent(streamRatio)}`}
            accent="var(--ui-monitor-summary-4)"
          />
        </div>

        <RuntimeStatusCard
          providers={snapshot?.provider_runtime ?? []}
          pollers={snapshot?.poller_runtime ?? []}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          <TrendChart
            title="请求趋势"
            subtitle={`最近 ${selectedTimeRange.label} · ${trendBuckets.length} 个时间桶`}
            buckets={trendBuckets}
            color="var(--ui-monitor-chart-requests)"
            shadowColor="var(--ui-monitor-chart-shadow)"
            accessor={(item) => item.requests}
          />
          <TrendChart
            title="Token 趋势"
            subtitle="按完成请求统计"
            buckets={trendBuckets}
            color="var(--ui-monitor-chart-tokens)"
            shadowColor="var(--ui-monitor-chart-shadow)"
            accessor={(item) => item.tokens}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          <BarList
            title="应用调用分布"
            rows={applicationRows}
            metricLabel="requests"
            accent="var(--ui-monitor-bar-app)"
          />
          <BarList
            title="供应商 Token 分布"
            rows={providerRows}
            metricLabel="total_tokens"
            accent="var(--ui-monitor-bar-provider)"
          />
        </div>

        <div className="ui-card" style={{ ...cardStyle, padding: 20 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#f8fafc' }}>
                最近请求明细
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                当前范围内共 {filteredRequests.length} 条请求，可点击行查看详情
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                最后活动: {formatDateTime(filteredSummary.last_request_at)}
              </div>
              <button
                onClick={handleExportTrend}
                className="ui-btn"
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                导出趋势 CSV
              </button>
              <button
                onClick={handleExportRequests}
                className="ui-btn ui-btn-primary"
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                导出明细 CSV
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>正在加载监控数据...</div>
          ) : filteredRequests.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>
              暂无符合当前筛选条件的请求数据
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: 960,
                }}
              >
                <thead>
                  <tr style={{ color: '#94a3b8', fontSize: 12, textAlign: 'left' }}>
                    <th style={{ padding: '10px 8px' }}>时间</th>
                    <th style={{ padding: '10px 8px' }}>应用</th>
                    <th style={{ padding: '10px 8px' }}>供应商</th>
                    <th style={{ padding: '10px 8px' }}>请求</th>
                    <th style={{ padding: '10px 8px' }}>模型</th>
                    <th style={{ padding: '10px 8px' }}>Tokens</th>
                    <th style={{ padding: '10px 8px' }}>耗时</th>
                    <th style={{ padding: '10px 8px' }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.slice(0, 18).map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedRequest(item)}
                      className="ui-table-row"
                      style={{
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                        color: '#e2e8f0',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap', color: '#cbd5e1' }}>
                        {formatDateTime(item.completed_at)}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div>{item.app_label}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          :{item.listen_port}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>{item.provider_label}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <div>{item.method} {item.path}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {item.protocol}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div>{item.response_model || item.target_model || item.request_model || '-'}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          req {item.request_model || '-'} / route {item.target_model || 'keep'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        <div>{formatCompact(item.total_tokens)}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          in {formatCompact(item.input_tokens)} · out {formatCompact(item.output_tokens)}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        {formatDuration(item.duration_ms)}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            borderRadius: 999,
                            background: item.success ? '#052e16' : '#450a0a',
                            color: item.success ? '#86efac' : '#fca5a5',
                            fontSize: 12,
                          }}
                        >
                          {item.status_code ?? '-'} {item.streamed ? '流式' : '标准'}
                        </span>
                        {item.error && (
                          <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 6 }}>
                            {item.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <RequestDetailDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)} />
    </div>
  );
}
