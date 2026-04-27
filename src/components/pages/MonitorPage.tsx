import { useCallback, useEffect, useMemo, useState } from "react";
import { getProxyMetrics } from "../../lib/tauri-api";
import { useAppStore } from "../../store/app-store";
import type {
  PollerRuntimeState,
  ProviderRuntimeState,
  ProxyMetricsEntitySummary,
  ProxyMetricsSnapshot,
  ProxyMetricsSummary,
  ProxyRequestMetric,
} from "../../types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RefreshCw, Download, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;
type TimeRangeKey = "24h" | "1w" | "1M";

const TIME_RANGE_OPTIONS: {
  key: TimeRangeKey;
  label: string;
  minutes: number;
  buckets: number;
}[] = [
  { key: "24h", label: "24 小时", minutes: 24 * 60, buckets: 12 },
  { key: "1w", label: "7 天", minutes: 7 * 24 * 60, buckets: 14 },
  { key: "1M", label: "30 天", minutes: 30 * 24 * 60, buckets: 15 },
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
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
  if (percent == null) return "#60a5fa";
  if (percent >= 100) return "#f87171";
  if (percent >= 70) return "#fbbf24";
  return "#4ade80";
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
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

function mergeSummary(
  target: ProxyMetricsSummary,
  source: ProxyMetricsSummary,
): ProxyMetricsSummary {
  const nextLast =
    !target.last_request_at ||
    (source.last_request_at && source.last_request_at > target.last_request_at)
      ? source.last_request_at
      : target.last_request_at;

  return {
    requests: target.requests + source.requests,
    successful_requests:
      target.successful_requests + source.successful_requests,
    failed_requests: target.failed_requests + source.failed_requests,
    streamed_requests: target.streamed_requests + source.streamed_requests,
    input_tokens: target.input_tokens + source.input_tokens,
    output_tokens: target.output_tokens + source.output_tokens,
    total_tokens: target.total_tokens + source.total_tokens,
    total_latency_ms: target.total_latency_ms + source.total_latency_ms,
    last_request_at: nextLast ?? null,
  };
}

function summarizeRequests(
  requests: ProxyRequestMetric[],
): ProxyMetricsSummary {
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

function buildSummaryFromEntity(
  entity?: ProxyMetricsEntitySummary | null,
): ProxyMetricsSummary {
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

function groupByApplication(
  requests: ProxyRequestMetric[],
): ProxyMetricsEntitySummary[] {
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

function groupByProvider(
  requests: ProxyRequestMetric[],
): ProxyMetricsEntitySummary[] {
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
  return (
    TIME_RANGE_OPTIONS.find((item) => item.key === key) ?? TIME_RANGE_OPTIONS[1]
  );
}

function isRequestInTimeRange(
  request: ProxyRequestMetric,
  rangeKey: TimeRangeKey,
): boolean {
  const completedAt = new Date(request.completed_at).getTime();
  if (Number.isNaN(completedAt)) return false;
  const config = getTimeRangeConfig(rangeKey);
  return completedAt >= Date.now() - config.minutes * 60 * 1000;
}

function buildTrendBuckets(
  requests: ProxyRequestMetric[],
  rangeKey: TimeRangeKey,
) {
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
        rangeKey === "1M"
          ? labelDate.toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
            })
          : labelDate.toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
            }),
      requests: 0,
      tokens: 0,
    };
  });

  requests.forEach((request) => {
    const time = new Date(request.completed_at).getTime();
    if (Number.isNaN(time) || time < start) return;
    const index = Math.min(
      config.buckets - 1,
      Math.floor((time - start) / bucketMs),
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
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  const escapeCell = (value: string | number | boolean | null | undefined) => {
    const text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

// ---------------------------------------------------------------------------
// Request Detail Sheet
// ---------------------------------------------------------------------------

function RequestDetailSheet({
  request,
  open,
  onOpenChange,
}: {
  request: ProxyRequestMetric | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!request) return null;

  const DetailRow = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-t border-border-soft py-3">
      <div className="text-muted text-xs">{label}</div>
      <div className="text-foreground text-[13px]">{children}</div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] max-w-full overflow-y-auto border-l border-border-soft bg-background sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle className="text-lg">请求详情</SheetTitle>
          <SheetDescription className="text-xs text-muted">
            {request.id}
          </SheetDescription>
        </SheetHeader>

        <div className="px-1 pb-6">
          <DetailRow label="应用 / 端口">
            {request.app_label} / :{request.listen_port}
          </DetailRow>
          <DetailRow label="供应商">{request.provider_label}</DetailRow>
          <DetailRow label="完整路径">
            <span className="break-all">
              {request.method} {request.path}
            </span>
          </DetailRow>
          <DetailRow label="协议 / 状态">
            {request.protocol} / {request.status_code ?? "-"} /{" "}
            {request.streamed ? "流式" : "标准"}
          </DetailRow>
          <DetailRow label="模型映射">
            <div className="leading-relaxed">
              <div>请求模型: {request.request_model || "-"}</div>
              <div>路由目标模型: {request.target_model || "keep"}</div>
              <div>响应模型: {request.response_model || "-"}</div>
            </div>
          </DetailRow>
          <DetailRow label="Token">
            <div className="leading-relaxed">
              <div>输入: {formatNumber(request.input_tokens)}</div>
              <div>输出: {formatNumber(request.output_tokens)}</div>
              <div>总计: {formatNumber(request.total_tokens)}</div>
            </div>
          </DetailRow>
          <DetailRow label="耗时">
            {formatDuration(request.duration_ms)}
          </DetailRow>
          <DetailRow label="时间">
            <div className="leading-relaxed">
              <div>开始: {formatDateTime(request.started_at)}</div>
              <div>结束: {formatDateTime(request.completed_at)}</div>
            </div>
          </DetailRow>
          <DetailRow label="错误信息">
            <span
              className={cn(
                "whitespace-pre-wrap break-words",
                request.error ? "text-destructive" : "text-muted",
              )}
            >
              {request.error || "无"}
            </span>
          </DetailRow>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

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
    <Card className="relative overflow-hidden border-border bg-card/90 shadow-[var(--color-shadow-soft)]">
      <CardContent className="p-5">
        <div
          className="absolute -right-6 -top-6 h-24 w-24 rounded-full blur-[30px] opacity-60"
          style={{ background: accent }}
        />
        <div className="mb-2 text-xs text-muted">{title}</div>
        <div className="text-[30px] font-bold text-foreground mb-2">
          {value}
        </div>
        <div className="text-xs text-muted">{subValue}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bar List
// ---------------------------------------------------------------------------

function BarList({
  title,
  rows,
  metricLabel,
  accent,
}: {
  title: string;
  rows: ProxyMetricsEntitySummary[];
  metricLabel: "requests" | "total_tokens";
  accent: string;
}) {
  const maxValue =
    rows.length > 0 ? Math.max(...rows.map((item) => item[metricLabel])) : 1;

  return (
    <Card className="min-h-[300px] border-border bg-card/90 shadow-[var(--color-shadow-soft)]">
      <CardContent className="p-5">
        <div className="mb-4 text-base font-semibold text-foreground">
          {title}
        </div>
        {rows.length === 0 ? (
          <div className="text-muted text-[13px]">暂无数据</div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {rows.slice(0, 6).map((row) => (
              <div key={row.id}>
                <div className="flex justify-between gap-3 text-[13px] mb-1.5">
                  <span className="text-foreground overflow-hidden text-ellipsis">
                    {row.label}
                  </span>
                  <span className="text-muted whitespace-nowrap">
                    {metricLabel === "requests"
                      ? `${formatNumber(row.requests)} 次`
                      : `${formatCompact(row.total_tokens)} Tokens`}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${maxValue === 0 ? 0 : (row[metricLabel] / maxValue) * 100}%`,
                      background: accent,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trend Chart
// ---------------------------------------------------------------------------

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
  accessor: (item: {
    label: string;
    requests: number;
    tokens: number;
  }) => number;
}) {
  const max = Math.max(1, ...buckets.map(accessor));

  return (
    <Card className="min-h-[280px] border-border bg-card/90 shadow-[var(--color-shadow-soft)]">
      <CardContent className="p-5">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted mt-1">{subtitle}</div>
        <div
          className="grid gap-2.5 items-end h-[180px] mt-5"
          style={{
            gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
          }}
        >
          {buckets.map((bucket) => {
            const value = accessor(bucket);
            return (
              <div
                key={bucket.label}
                className="flex flex-col items-center gap-2"
              >
                <div className="text-[11px] text-muted min-h-[16px]">
                  {value > 0 ? formatCompact(value) : ""}
                </div>
                <div
                  className="w-full max-w-[32px] rounded-xl"
                  style={{
                    height: `${(value / max) * 130 + (value > 0 ? 10 : 0)}px`,
                    minHeight: value > 0 ? 10 : 4,
                    background: color,
                    boxShadow: `0 8px 18px ${shadowColor}`,
                  }}
                />
                <div className="text-[11px] text-dim">{bucket.label}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Runtime Status Card
// ---------------------------------------------------------------------------

function RuntimeStatusCard({
  providers,
  pollers,
}: {
  providers: ProviderRuntimeState[];
  pollers: PollerRuntimeState[];
}) {
  const [collapsed, setCollapsed] = useState(true);

  const statusColor = (status: ProviderRuntimeState["status"]) => {
    switch (status) {
      case "healthy":
        return "#22c55e";
      case "degraded":
        return "#f59e0b";
      case "circuit_open":
        return "#ef4444";
      default:
        return "#64748b";
    }
  };

  const statusLabel = (status: ProviderRuntimeState["status"]) => {
    switch (status) {
      case "healthy":
        return "健康";
      case "half_open":
        return "半开恢复";
      case "degraded":
        return "降级";
      case "circuit_open":
        return "熔断中";
      default:
        return "未知";
    }
  };

  const pollerStrategyLabel = (strategy: PollerRuntimeState["strategy"]) => {
    switch (strategy) {
      case "weighted":
        return "加权轮询";
      case "network_status":
        return "网络状态优先";
      case "token_remaining":
        return "剩余额度优先";
      default:
        return strategy;
    }
  };

  const showTargetWeight = (strategy: PollerRuntimeState["strategy"]) =>
    strategy === "weighted";

  return (
    <Card className="border-border bg-card/90 shadow-[var(--color-shadow-soft)]">
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="mb-0 flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-0 text-inherit"
        >
          <span className="text-base font-semibold text-foreground">
            运行时状态
          </span>
          <ChevronRight
            className={cn(
              "w-5 h-5 text-muted transition-transform duration-200",
              !collapsed && "rotate-90",
            )}
          />
        </button>
        {!collapsed && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4 mt-4">
            <div className="flex flex-col gap-2.5">
              <div className="text-xs text-muted">供应商健康 / 熔断</div>
              {providers.length === 0 && (
                <div className="text-dim text-[13px]">暂无供应商运行态数据</div>
              )}
              {providers.slice(0, 8).map((provider) => (
                <div
                  key={provider.provider_id}
                  className="rounded-xl border border-border bg-surface/55 p-3"
                >
                  <div className="flex justify-between gap-3 items-center">
                    <div className="text-foreground text-[13px] font-semibold">
                      {provider.provider_label}
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[11px] font-bold"
                      style={{
                        color: statusColor(provider.status),
                        borderColor: `${statusColor(provider.status)}55`,
                        background: `${statusColor(provider.status)}22`,
                      }}
                    >
                      {statusLabel(provider.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5 text-xs text-muted">
                    <div>
                      连续失败: {formatNumber(provider.consecutive_failures)}
                    </div>
                    <div
                      style={{
                        color: usageColor(providerUsagePercent(provider)),
                      }}
                    >
                      使用率:{" "}
                      {providerUsagePercent(provider) == null
                        ? "无限制"
                        : formatPercent(providerUsagePercent(provider) ?? 0)}
                    </div>
                    <div>已使用: {formatMillions(provider.used_tokens)}</div>
                    <div>
                      预算:{" "}
                      {provider.budget_tokens > 0
                        ? formatMillions(provider.budget_tokens)
                        : "无限制"}
                    </div>
                    <div>
                      阈值 / 冷却: {provider.failure_threshold} /{" "}
                      {provider.cooldown_seconds}s
                    </div>
                    <div>探测间隔: {provider.probe_interval_seconds}s</div>
                    <div>
                      半开开始: {formatDateTime(provider.half_open_since)}
                    </div>
                    <div>
                      恢复试探: {formatNumber(provider.recovery_attempts)}
                    </div>
                    <div>
                      探测时间: {formatDateTime(provider.last_probe_at)}
                    </div>
                    <div>
                      熔断至: {formatDateTime(provider.circuit_open_until)}
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <div className="text-[11px] text-muted mb-1.5">
                      熔断时间线
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {provider.timeline.length === 0 && (
                        <div className="text-[11px] text-dim">暂无熔断事件</div>
                      )}
                      {provider.timeline
                        .slice(-4)
                        .reverse()
                        .map((event) => (
                          <div
                            key={`${provider.provider_id}-${event.at}-${event.kind}`}
                            className="text-[11px] text-muted leading-relaxed"
                          >
                            <span className="text-muted">
                              {formatDateTime(event.at)}
                            </span>
                            {" · "}
                            <span className="text-foreground">
                              {event.detail}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                  {provider.last_error && (
                    <div className="text-[11px] text-destructive mt-2 leading-relaxed">
                      最近错误: {provider.last_error}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="text-xs text-muted">轮询节点最近选路</div>
              {pollers.length === 0 && (
                <div className="text-dim text-[13px]">
                  暂无轮询节点运行态数据
                </div>
              )}
              {pollers.slice(0, 8).map((poller) => (
                <div
                  key={poller.poller_id}
                  className="rounded-xl border border-border bg-surface/55 p-3"
                >
                  <div className="text-foreground text-[13px] font-semibold">
                    {poller.poller_label}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5 text-xs text-muted">
                    <div>策略: {pollerStrategyLabel(poller.strategy)}</div>
                    <div>游标: {poller.cursor}</div>
                    <div>
                      阈值 / 冷却: {poller.failure_threshold} /{" "}
                      {poller.cooldown_seconds}s
                    </div>
                    <div>探测间隔: {poller.probe_interval_seconds}s</div>
                    <div>总选路: {formatNumber(poller.total_selections)}</div>
                    <div>最近目标: {poller.last_selected_target || "-"}</div>
                  </div>
                  <div className="text-[11px] text-foreground mt-2 leading-relaxed">
                    最近供应商: {poller.last_selected_provider_label || "-"}
                  </div>
                  <div className="text-[11px] text-dim mt-1">
                    最近时间: {formatDateTime(poller.last_selected_at)}
                  </div>
                  <div className="mt-2.5">
                    <div className="text-[11px] text-muted mb-1.5">
                      {showTargetWeight(poller.strategy)
                        ? "权重命中统计"
                        : "目标命中统计"}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {poller.target_stats.length === 0 && (
                        <div className="text-[11px] text-dim">
                          暂无目标命中数据
                        </div>
                      )}
                      {poller.target_stats.slice(0, 4).map((stat) => (
                        <div
                          key={`${poller.poller_id}-${stat.target_id}`}
                          className="text-[11px] text-foreground grid gap-2"
                          style={{
                            gridTemplateColumns: showTargetWeight(
                              poller.strategy,
                            )
                              ? "1fr auto auto"
                              : "1fr auto",
                          }}
                        >
                          <span>{stat.target_label || stat.target_id}</span>
                          {showTargetWeight(poller.strategy) && (
                            <span className="text-purple-300">
                              权重 {stat.configured_weight}
                            </span>
                          )}
                          <span className="text-muted">
                            命中 {formatNumber(stat.hits)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MonitorPage() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const [snapshot, setSnapshot] = useState<ProxyMetricsSnapshot | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("24h");
  const [selectedApp, setSelectedApp] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [selectedRequest, setSelectedRequest] =
    useState<ProxyRequestMetric | null>(null);
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
    return snapshot.recent_requests.filter((item) =>
      isRequestInTimeRange(item, timeRange),
    );
  }, [snapshot, timeRange]);

  const filteredRequests = useMemo(() => {
    return timeFilteredRequests.filter((item) => {
      if (selectedApp !== "all" && item.app_id !== selectedApp) return false;
      if (selectedProvider !== "all" && item.provider_id !== selectedProvider)
        return false;
      return true;
    });
  }, [timeFilteredRequests, selectedApp, selectedProvider]);

  const filteredSummary = useMemo(
    () => summarizeRequests(filteredRequests),
    [filteredRequests],
  );

  const applicationRows = useMemo(() => {
    const source =
      selectedProvider === "all"
        ? timeFilteredRequests
        : timeFilteredRequests.filter(
            (item) => item.provider_id === selectedProvider,
          );
    return groupByApplication(source);
  }, [timeFilteredRequests, selectedProvider]);

  const providerRows = useMemo(() => {
    const source =
      selectedApp === "all"
        ? timeFilteredRequests
        : timeFilteredRequests.filter((item) => item.app_id === selectedApp);
    return groupByProvider(source);
  }, [timeFilteredRequests, selectedApp]);

  const trendBuckets = useMemo(
    () => buildTrendBuckets(filteredRequests, timeRange),
    [filteredRequests, timeRange],
  );

  const selectedTimeRange = useMemo(
    () => getTimeRangeConfig(timeRange),
    [timeRange],
  );

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
        "请求ID",
        "完成时间",
        "应用",
        "端口",
        "供应商",
        "方法",
        "路径",
        "协议",
        "请求模型",
        "路由模型",
        "响应模型",
        "状态码",
        "成功",
        "流式",
        "输入Token",
        "输出Token",
        "总Token",
        "耗时ms",
        "错误信息",
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
      ]),
    );
  }, [filteredRequests, timeRange]);

  const handleExportTrend = useCallback(() => {
    exportCsv(
      `aastation-trend-${timeRange}.csv`,
      ["时间桶", "请求数", "Token"],
      trendBuckets.map((item) => [item.label, item.requests, item.tokens]),
    );
  }, [timeRange, trendBuckets]);

  return (
    <div className="ui-page ui-accent-monitor flex flex-1 overflow-auto">
      <div
        className="flex w-full flex-col gap-5 px-6 pb-[30px] pl-6"
        style={{
          paddingTop: "calc(var(--window-controls-safe-top) + 10px)",
          paddingRight: "calc(var(--window-controls-safe-right) + 12px)",
        }}
      >
        {/* Hero section */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_396px] lg:items-start">
            <div className="min-w-0">
              <div className="mb-2 text-[28px] font-bold text-foreground">
                API 监控中心
              </div>
              <div className="mb-3 inline-flex rounded-full border border-warning-border bg-warning/10 px-3 py-1 text-xs text-warning-foreground">
                Token 由本地估算，和实际计费可能有偏差
              </div>
              <div className="text-sm text-muted leading-relaxed max-w-[680px]">
                实时观察本地代理收到的 API 请求次数、Token
                使用量、请求耗时与最近调用明细。
                可按应用和供应商筛选，快速定位流量热点与异常来源。
              </div>
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-[396px]">
              <Card className="rounded-2xl border-border bg-surface/70 shadow-none">
                <CardContent className="p-4">
                  <div className="text-xs text-muted mb-1.5">代理状态</div>
                  <div className="text-[22px] font-bold text-foreground">
                    {proxyStatus.running ? "运行中" : "未启动"}
                  </div>
                  <div
                    className={cn(
                      "text-xs mt-2",
                      proxyStatus.running ? "text-green-300" : "text-dim",
                    )}
                  >
                    {proxyStatus.running
                      ? `监听端口 ${proxyStatus.listen_ports.join(", ")}`
                      : "启动代理后开始采集请求数据"}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-border bg-surface/70 shadow-none">
                <CardContent className="p-4">
                  <div className="text-xs text-muted mb-1.5">最近刷新</div>
                  <div className="text-[22px] font-bold text-foreground">
                    {snapshot ? formatDateTime(snapshot.generated_at) : "--"}
                  </div>
                  <div className="text-xs text-dim mt-2">
                    {refreshing
                      ? "同步中..."
                      : `每 ${POLL_INTERVAL_MS / 1000} 秒自动刷新`}
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        {/* Filter bar */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardContent className="flex flex-wrap items-end gap-3.5 p-[18px]">
            <div className="min-w-[220px]">
              <Label className="text-xs text-muted mb-2 block">时间范围</Label>
              <div className="flex gap-2 flex-wrap">
                {TIME_RANGE_OPTIONS.map((option) => (
                  <Button
                    key={option.key}
                    variant={timeRange === option.key ? "accent" : "secondary"}
                    size="sm"
                    onClick={() => setTimeRange(option.key)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="min-w-[220px]">
              <Label className="text-xs text-muted mb-2 block">应用筛选</Label>
              <Select value={selectedApp} onValueChange={setSelectedApp}>
                <SelectTrigger>
                  <SelectValue placeholder="全部应用" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部应用</SelectItem>
                  {(snapshot?.applications ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-[220px]">
              <Label className="text-xs text-muted mb-2 block">
                供应商筛选
              </Label>
              <Select
                value={selectedProvider}
                onValueChange={setSelectedProvider}
              >
                <SelectTrigger>
                  <SelectValue placeholder="全部供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部供应商</SelectItem>
                  {(snapshot?.providers ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTimeRange("24h");
                setSelectedApp("all");
                setSelectedProvider("all");
              }}
            >
              重置筛选
            </Button>

            <Button
              variant="accent"
              size="sm"
              onClick={() => loadMetrics()}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
              />
              {refreshing ? "刷新中..." : "立即刷新"}
            </Button>

            {error && (
              <div className="text-xs text-destructive">
                数据拉取失败: {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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

        {/* Request table */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardContent className="p-5">
            <div className="flex justify-between items-center gap-3 flex-wrap mb-4">
              <div>
                <div className="text-base font-semibold text-foreground">
                  最近请求明细
                </div>
                <div className="text-xs text-muted mt-1">
                  当前范围内共 {filteredRequests.length}{" "}
                  条请求，可点击行查看详情
                </div>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <div className="text-xs text-muted">
                  最后活动: {formatDateTime(filteredSummary.last_request_at)}
                </div>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={handleExportTrend}
                  className="gap-1.5"
                >
                  <Download className="w-3 h-3" /> 导出趋势 CSV
                </Button>
                <Button
                  variant="accent"
                  size="xs"
                  onClick={handleExportRequests}
                  className="gap-1.5"
                >
                  <Download className="w-3 h-3" /> 导出明细 CSV
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="text-muted text-[13px]">正在加载监控数据...</div>
            ) : filteredRequests.length === 0 ? (
              <div className="text-dim text-[13px]">
                暂无符合当前筛选条件的请求数据
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface/35">
                <table className="min-w-[960px] w-full border-collapse">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-3 py-3">时间</th>
                      <th className="px-3 py-3">应用</th>
                      <th className="px-3 py-3">供应商</th>
                      <th className="px-3 py-3">请求</th>
                      <th className="px-3 py-3">模型</th>
                      <th className="px-3 py-3">Tokens</th>
                      <th className="px-3 py-3">耗时</th>
                      <th className="px-3 py-3">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.slice(0, 18).map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedRequest(item)}
                        className="cursor-pointer border-t border-border-soft text-[13px] text-foreground transition-colors hover:bg-surface-hover/70"
                      >
                        <td className="whitespace-nowrap px-3 py-3 text-muted">
                          {formatDateTime(item.completed_at)}
                        </td>
                        <td className="px-3 py-3">
                          <div>{item.app_label}</div>
                          <div className="text-[11px] text-dim mt-0.5">
                            :{item.listen_port}
                          </div>
                        </td>
                        <td className="px-3 py-3">{item.provider_label}</td>
                        <td className="px-3 py-3">
                          <div>
                            {item.method} {item.path}
                          </div>
                          <div className="text-[11px] text-dim mt-0.5">
                            {item.protocol}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div>
                            {item.response_model ||
                              item.target_model ||
                              item.request_model ||
                              "-"}
                          </div>
                          <div className="text-[11px] text-dim mt-0.5">
                            req {item.request_model || "-"} / route{" "}
                            {item.target_model || "keep"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div>{formatCompact(item.total_tokens)}</div>
                          <div className="text-[11px] text-dim mt-0.5">
                            in {formatCompact(item.input_tokens)} · out{" "}
                            {formatCompact(item.output_tokens)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {formatDuration(item.duration_ms)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs gap-1.5",
                              item.success
                                ? "bg-green-900/60 text-green-300 border-green-500/30"
                                : "bg-red-900/60 text-red-300 border-red-500/30",
                            )}
                          >
                            {item.status_code ?? "-"}{" "}
                            {item.streamed ? "流式" : "标准"}
                          </Badge>
                          {item.error && (
                            <div className="text-[11px] text-destructive mt-1.5">
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
          </CardContent>
        </Card>
      </div>

      <RequestDetailSheet
        request={selectedRequest}
        open={!!selectedRequest}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
      />
    </div>
  );
}
