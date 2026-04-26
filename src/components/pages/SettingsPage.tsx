import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { useSettingsStore } from '../../store/settings-store';
import { useFlowStore } from '../../store/flow-store';
import { toast } from '../../store/toast-store';
import {
  checkForAppUpdate,
  configureClaudeCode,
  configureCodexCli,
  configureOpenCode,
  getLogRuntimeStatus,
  installAppUpdate,
  isClaudeConfigured,
  isCodexCliConfigured,
  isOpenCodeConfigured,
  openLogDir,
  pollRuntimeLogs,
  restoreClaudeConfig,
  restoreCodexCliConfig,
  restoreOpenCodeConfig,
  type LogRuntimeStatus,
  unconfigureClaudeCode,
  unconfigureCodexCli,
  unconfigureOpenCode,
} from '../../lib/tauri-api';
import type { ApplicationNodeData } from '../../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ChevronRight, Eye, EyeOff, Copy, RefreshCw, Download, FolderOpen, Pause, Play, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type SettingsSubTab = 'general' | 'applications' | 'logs';

const LOG_POLL_INTERVAL_MS = 1200;
const LOG_MAX_LINES = 1200;

export default function SettingsPage() {
  const { settings, saveSettings } = useSettingsStore();
  const availableUpdate = useAppStore((s) => s.availableUpdate);
  const setAvailableUpdate = useAppStore((s) => s.setAvailableUpdate);
  const clearAvailableUpdate = useAppStore((s) => s.clearAvailableUpdate);
  const nodes = useFlowStore((s) => s.nodes);

  const [subTab, setSubTab] = useState<SettingsSubTab>('general');

  // -----------------------------------------------------------------------
  // General
  // -----------------------------------------------------------------------
  const [portRange, setPortRange] = useState(settings.listenPortRange);
  const [address, setAddress] = useState(settings.listenAddress);
  const [logDirMaxMb, setLogDirMaxMb] = useState(String(settings.logDirMaxMb ?? 500));
  const [launchAtStartup, setLaunchAtStartup] = useState(settings.launchAtStartup);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(settings.autoCheckUpdate);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPortRange(settings.listenPortRange);
    setAddress(settings.listenAddress);
    setLogDirMaxMb(String(settings.logDirMaxMb ?? 500));
    setLaunchAtStartup(settings.launchAtStartup);
    setAutoCheckUpdate(settings.autoCheckUpdate);
  }, [settings]);

  const handleSaveGeneral = async () => {
    setSaving(true);
    try {
      const parsedMb = parseInt(logDirMaxMb, 10);
      if (isNaN(parsedMb) || parsedMb < 1) {
        toast.error('日志目录上限须为大于 0 的整数（MB）');
        setSaving(false);
        return;
      }
      await saveSettings({
        listenPortRange: portRange,
        listenAddress: address,
        proxyAuthToken: settings.proxyAuthToken,
        logDirMaxMb: parsedMb,
        launchAtStartup,
        autoCheckUpdate,
        autoInstallUpdate: settings.autoInstallUpdate,
      });
      toast.success('常规设置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存设置失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const authToken = settings.proxyAuthToken || '(未加载)';
  const maskedToken = authToken.length > 12
    ? authToken.slice(0, 8) + '••••••••' + authToken.slice(-4)
    : '••••••••';

  const handleManualUpdateAction = async () => {
    if (checkingUpdate || installingUpdate) return;

    if (availableUpdate) {
      setInstallingUpdate(true);
      try {
        const result = await installAppUpdate();
        if (!result.hasUpdate) {
          clearAvailableUpdate();
          toast.info(`当前已是最新版本（${result.currentVersion}）`);
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`安装更新失败：${msg}`);
      } finally {
        setInstallingUpdate(false);
      }
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await checkForAppUpdate();
      if (!result.hasUpdate) {
        clearAvailableUpdate();
        toast.info(`当前已是最新版本（${result.currentVersion}）`);
        return;
      }
      if (!result.latestVersion) {
        toast.warning('已检测到更新，但未获取到版本号，请稍后重试。');
        return;
      }
      setAvailableUpdate({
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        notes: result.notes,
      });
      toast.info(`检测到新版本 ${result.latestVersion}，请再次点击"立即更新"开始下载并安装。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`检查更新失败：${msg}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // -----------------------------------------------------------------------
  // Application settings
  // -----------------------------------------------------------------------
  const applicationNodes = useMemo(
    () => nodes.filter((n) => n.data.nodeType === 'application'),
    [nodes],
  );
  const [claudeConfigured, setClaudeConfigured] = useState(false);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeActioning, setClaudeActioning] = useState(false);
  const [claudeTokenVisible, setClaudeTokenVisible] = useState(false);

  const [openCodeConfigured, setOpenCodeConfigured] = useState(false);
  const [openCodeActioning, setOpenCodeActioning] = useState(false);
  const [openCodeTokenVisible, setOpenCodeTokenVisible] = useState(false);

  const [codexCliConfigured, setCodexCliConfigured] = useState(false);
  const [codexCliActioning, setCodexCliActioning] = useState(false);
  const [codexCliTokenVisible, setCodexCliTokenVisible] = useState(false);
  const [expandedAppPanel, setExpandedAppPanel] = useState<'claude' | 'opencode' | 'codex' | null>(null);

  const claudeNodes = useMemo(
    () => applicationNodes.filter((n) => (n.data as ApplicationNodeData).appType === 'claude_code'),
    [applicationNodes],
  );

  const openCodeNodes = useMemo(
    () => applicationNodes.filter((n) => (n.data as ApplicationNodeData).appType === 'open_code'),
    [applicationNodes],
  );

  const codexCliNodes = useMemo(
    () => applicationNodes.filter((n) => (n.data as ApplicationNodeData).appType === 'codex_cli'),
    [applicationNodes],
  );

  const claudeProxyUrl = useMemo(() => {
    const valid = claudeNodes
      .map((n) => n.data as ApplicationNodeData)
      .find((d) => Number.isInteger(d.listenPort) && d.listenPort > 0);
    return valid ? `http://127.0.0.1:${valid.listenPort}` : null;
  }, [claudeNodes]);

  const openCodeProxyUrl = useMemo(() => {
    const valid = openCodeNodes
      .map((n) => n.data as ApplicationNodeData)
      .find((d) => Number.isInteger(d.listenPort) && d.listenPort > 0);
    return valid ? `http://127.0.0.1:${valid.listenPort}` : null;
  }, [openCodeNodes]);

  const codexCliProxyUrl = useMemo(() => {
    const valid = codexCliNodes
      .map((n) => n.data as ApplicationNodeData)
      .find((d) => Number.isInteger(d.listenPort) && d.listenPort > 0);
    return valid ? `http://127.0.0.1:${valid.listenPort}` : null;
  }, [codexCliNodes]);

  const refreshClaudeConfigStatus = useCallback(async () => {
    setClaudeLoading(true);
    try {
      const configured = await isClaudeConfigured();
      setClaudeConfigured(configured);
      const ocConfigured = await isOpenCodeConfigured();
      setOpenCodeConfigured(ocConfigured);
      const codexConfigured = await isCodexCliConfigured();
      setCodexCliConfigured(codexConfigured);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`读取配置状态失败：${msg}`);
    } finally {
      setClaudeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab !== 'applications') return;
    refreshClaudeConfigStatus();
  }, [subTab, refreshClaudeConfigStatus]);

  const handleConfigureClaude = async () => {
    if (claudeActioning) return;
    if (!claudeProxyUrl) {
      toast.warning('未发现可用的 Claude Code 监听端口，请先发布并确保端口已分配。');
      return;
    }
    setClaudeActioning(true);
    try {
      await configureClaudeCode(claudeProxyUrl);
      toast.success('Claude Code 配置文件已写入，并自动生成备份。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 Claude Code 配置失败：${msg}`);
    } finally {
      setClaudeActioning(false);
    }
  };

  const handleUnconfigureClaude = async () => {
    if (claudeActioning) return;
    setClaudeActioning(true);
    try {
      await unconfigureClaudeCode();
      toast.success('已移除 Claude Code 的 AAStation 管理配置。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`移除 Claude Code 配置失败：${msg}`);
    } finally {
      setClaudeActioning(false);
    }
  };

  const handleRestoreClaudeBackup = async () => {
    if (claudeActioning) return;
    setClaudeActioning(true);
    try {
      await restoreClaudeConfig();
      toast.success('Claude Code 配置已从备份恢复。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`恢复 Claude Code 备份失败：${msg}`);
    } finally {
      setClaudeActioning(false);
    }
  };

  const handleConfigureOpenCode = async () => {
    if (openCodeActioning) return;
    if (!openCodeProxyUrl) {
      toast.warning('未发现可用的 OpenCode 监听端口，请先发布并确保端口已分配。');
      return;
    }
    setOpenCodeActioning(true);
    try {
      await configureOpenCode(openCodeProxyUrl);
      toast.success('OpenCode 配置文件已写入，并自动生成备份。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 OpenCode 配置失败：${msg}`);
    } finally {
      setOpenCodeActioning(false);
    }
  };

  const handleUnconfigureOpenCode = async () => {
    if (openCodeActioning) return;
    setOpenCodeActioning(true);
    try {
      await unconfigureOpenCode();
      toast.success('已移除 OpenCode 的 AAStation 管理配置。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`移除 OpenCode 配置失败：${msg}`);
    } finally {
      setOpenCodeActioning(false);
    }
  };

  const handleRestoreOpenCodeBackup = async () => {
    if (openCodeActioning) return;
    setOpenCodeActioning(true);
    try {
      await restoreOpenCodeConfig();
      toast.success('OpenCode 配置已从备份恢复。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`恢复 OpenCode 备份失败：${msg}`);
    } finally {
      setOpenCodeActioning(false);
    }
  };

  const handleConfigureCodexCli = async () => {
    if (codexCliActioning) return;
    if (!codexCliProxyUrl) {
      toast.warning('未发现可用的 Codex CLI 监听端口，请先发布并确保端口已分配。');
      return;
    }
    setCodexCliActioning(true);
    try {
      await configureCodexCli(codexCliProxyUrl);
      toast.success('Codex CLI 配置文件已写入，并自动生成备份。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 Codex CLI 配置失败：${msg}`);
    } finally {
      setCodexCliActioning(false);
    }
  };

  const handleUnconfigureCodexCli = async () => {
    if (codexCliActioning) return;
    setCodexCliActioning(true);
    try {
      await unconfigureCodexCli();
      toast.success('已移除 Codex CLI 的 AAStation 管理配置。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`移除 Codex CLI 配置失败：${msg}`);
    } finally {
      setCodexCliActioning(false);
    }
  };

  const handleRestoreCodexCliBackup = async () => {
    if (codexCliActioning) return;
    setCodexCliActioning(true);
    try {
      await restoreCodexCliConfig();
      toast.success('Codex CLI 配置已从备份恢复。');
      await refreshClaudeConfigStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`恢复 Codex CLI 备份失败：${msg}`);
    } finally {
      setCodexCliActioning(false);
    }
  };

  // -----------------------------------------------------------------------
  // Runtime logs
  // -----------------------------------------------------------------------
  const [runtimeStatus, setRuntimeStatus] = useState<LogRuntimeStatus | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logFileName, setLogFileName] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logPolling, setLogPolling] = useState(false);
  const [logPaused, setLogPaused] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const logScrollerRef = useRef<HTMLDivElement | null>(null);
  const logCursorRef = useRef<{ fileName?: string; offset: number }>({ offset: 0 });

  const pollLogs = useCallback(async () => {
    if (subTab !== 'logs' || logPaused) return;
    try {
      setLogPolling(true);
      const result = await pollRuntimeLogs({
        file_name: logCursorRef.current.fileName,
        offset: logCursorRef.current.offset,
        max_bytes: 64 * 1024,
      });

      logCursorRef.current = {
        fileName: result.file_name ?? undefined,
        offset: result.next_offset,
      };
      setLogFileName(result.file_name);

      const extraLines: string[] = [];
      if (result.rotated && result.file_name) {
        extraLines.push(`[系统] 检测到日志文件切换：${result.file_name}`);
      }
      if (result.truncated) {
        extraLines.push('[系统] 日志量较大，已按增量窗口截断读取。');
      }

      if (result.lines.length > 0 || extraLines.length > 0) {
        setLogLines((prev) => [...prev, ...extraLines, ...result.lines].slice(-LOG_MAX_LINES));
      }
      setLogError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogError(msg);
    } finally {
      setLogPolling(false);
    }
  }, [subTab, logPaused]);

  useEffect(() => {
    if (subTab !== 'logs') return;
    let disposed = false;

    (async () => {
      try {
        const status = await getLogRuntimeStatus();
        if (!disposed) setRuntimeStatus(status);
      } catch (err) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          setLogError(msg);
        }
      }
    })();

    pollLogs();
    const timer = window.setInterval(() => {
      pollLogs();
    }, LOG_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [subTab, pollLogs]);

  useEffect(() => {
    if (!autoFollow) return;
    const el = logScrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines, autoFollow]);

  const handleLogScroll = () => {
    const el = logScrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    setAutoFollow(nearBottom);
  };

  const handleReloadLogs = () => {
    logCursorRef.current = { offset: 0 };
    setLogLines([]);
    setLogFileName(null);
    setAutoFollow(true);
    pollLogs();
  };

  // -----------------------------------------------------------------------
  // App config panel component
  // -----------------------------------------------------------------------
  function AppConfigPanel({
    title,
    configured,
    expanded,
    onToggle,
    onConfigure,
    onRestore,
    onUnconfigure,
    actioning,
    configurable,
    nodes: appNodes,
    proxyUrl,
    tokenVisible: appTokenVisible,
    onToggleToken,
    description,
    envDescription,
  }: {
    title: string;
    configured: boolean;
    expanded: boolean;
    onToggle: () => void;
    onConfigure: () => void;
    onRestore: () => void;
    onUnconfigure: () => void;
    actioning: boolean;
    configurable: boolean;
    nodes: typeof claudeNodes;
    proxyUrl: string | null;
    tokenVisible: boolean;
    onToggleToken: () => void;
    description: string;
    envDescription: string;
  }) {
    return (
      <Card className="relative border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
        <CardContent className="p-4">
          <div className="flex justify-between items-start">
            <button
              type="button"
              onClick={onToggle}
              className="bg-transparent border-none text-foreground p-0 m-0 cursor-pointer text-left w-full pr-32"
            >
              <div className="text-base font-bold text-foreground min-h-[24px]">{title}</div>
            </button>
            <Badge variant={configured ? 'success' : 'outline'} className="absolute top-3.5 right-12">
              {configured ? '已配置' : '未配置'}
            </Badge>
            <ChevronRight
              className={cn(
                "absolute top-3.5 right-3.5 w-5 h-5 text-muted transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          </div>

          {expanded && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted leading-relaxed">{description}</p>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2.5">
                <div className="rounded-xl border border-border bg-surface/60 p-3">
                  <div className="text-[11px] text-dim">检测到节点</div>
                  <div className="text-xl text-foreground font-bold mt-1">{appNodes.length}</div>
                </div>
                <div className="rounded-xl border border-border bg-surface/60 p-3">
                  <div className="text-[11px] text-dim">配置代理地址</div>
                  <div className="text-[13px] text-foreground mt-1">
                    {proxyUrl ?? '暂无可用端口'}
                  </div>
                </div>
              </div>

              {appNodes.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {appNodes.map((node) => {
                    const data = node.data as ApplicationNodeData;
                    return (
                      <div
                        key={node.id}
                        className="rounded-lg border border-border bg-surface/55 px-2.5 py-2 text-xs text-foreground"
                      >
                        {data.label} · {node.id} · 端口 :{data.listenPort || 0}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted leading-relaxed">{envDescription}</p>

              <Button variant="ghost" size="xs" onClick={onToggleToken} className="mt-1">
                {appTokenVisible ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                {appTokenVisible ? '隐藏令牌展示' : '显示令牌展示'}
              </Button>

              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="accent"
                  size="sm"
                  onClick={onConfigure}
                  disabled={actioning || !configurable}
                >
                  {actioning ? '处理中...' : '一键写入配置'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRestore}
                  disabled={actioning}
                >
                  从备份恢复
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onUnconfigure}
                  disabled={actioning}
                >
                  移除托管配置
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // -----------------------------------------------------------------------
  // Render panels
  // -----------------------------------------------------------------------
  const renderGeneralPanel = () => (
    <div className="max-w-[860px] w-full mx-auto">
      <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
        <CardHeader>
          <CardTitle className="text-xl">常规设置</CardTitle>
          <CardDescription>
            用于配置代理监听地址、端口范围和代理认证令牌展示。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted text-xs">监听端口范围</Label>
            <Input
              type="text"
              value={portRange}
              placeholder="9527-9537"
              onChange={(e) => setPortRange(e.target.value)}
            />
            <p className="text-xs text-dim">单端口示例: 9527；范围示例: 9527-9537。发布时会从该范围内分配应用端口。</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted text-xs">绑定地址</Label>
            <Input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted text-xs">日志目录大小上限（MB）</Label>
            <Input
              type="number"
              min={1}
              value={logDirMaxMb}
              onChange={(e) => setLogDirMaxMb(e.target.value)}
              className="max-w-[180px]"
            />
            <p className="text-xs text-dim">软件启动时若日志目录总大小超过此值，将自动从最旧的文件开始删除。默认 500 MB。</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-muted text-xs">系统启动</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={launchAtStartup}
                onCheckedChange={setLaunchAtStartup}
              />
              <span className="text-sm text-foreground">开机自启动</span>
            </div>
            <p className="text-xs text-dim">勾选后会在系统启动时自动启动 AAStation。</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-muted text-xs">自动更新</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={autoCheckUpdate}
                onCheckedChange={setAutoCheckUpdate}
              />
              <span className="text-sm text-foreground">启动时自动检查更新</span>
            </div>
            <p className="text-xs text-dim">
              版本来源为 GitHub Releases，安装前会做签名校验。Windows 下安装时可能触发系统安装器窗口。
              启动自动检查仅负责提示，不会直接安装更新。
            </p>
            {availableUpdate && (
              <p className="text-xs text-blue-300 leading-relaxed">
                已发现新版本 {availableUpdate.latestVersion}（当前 {availableUpdate.currentVersion}），
                点击下方"立即更新"后将自动下载并安装。
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleManualUpdateAction}
              disabled={checkingUpdate || installingUpdate}
              className="gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {installingUpdate ? '安装中...' : checkingUpdate ? '检查中...' : availableUpdate ? '立即更新' : '立即检查更新'}
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-muted text-xs">
              代理认证令牌
              <span className="text-dim text-[11px] ml-2">只读 · 客户端通过此令牌向代理认证</span>
            </Label>
            <div className="flex gap-2 items-center flex-wrap">
              <Input
                type={tokenVisible ? 'text' : 'password'}
                value={tokenVisible ? authToken : maskedToken}
                readOnly
                className={cn(
                  "flex-1 min-w-[320px]",
                  !tokenVisible && "text-muted"
                )}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTokenVisible(!tokenVisible)}
                className="gap-1.5"
              >
                {tokenVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {tokenVisible ? '隐藏' : '显示'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(authToken);
                  toast.success('令牌已复制');
                }}
                className="gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                复制
              </Button>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <Button
              variant="accent"
              onClick={handleSaveGeneral}
              disabled={saving}
              className="min-w-[120px]"
            >
              {saving ? '保存中...' : '保存设置'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderApplicationsPanel = () => {
    const claudeConfigurable = claudeNodes.length > 0 && !!claudeProxyUrl;
    const openCodeConfigurable = openCodeNodes.length > 0 && !!openCodeProxyUrl;
    const codexConfigurable = codexCliNodes.length > 0 && !!codexCliProxyUrl;

    return (
      <div className="max-w-[980px] w-full mx-auto flex flex-col gap-3.5">
        <div className="flex justify-between gap-3 flex-wrap items-start">
          <div>
            <h2 className="text-xl font-bold text-foreground m-0">应用设置</h2>
            <p className="text-[13px] text-muted mt-2">
              集中管理需要修改用户本地配置文件的应用能力，并提供备份恢复入口。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshClaudeConfigStatus}
            disabled={claudeLoading || claudeActioning}
            className="gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", claudeLoading && "animate-spin")} />
            {claudeLoading ? '状态刷新中...' : '刷新配置状态'}
          </Button>
        </div>

        <AppConfigPanel
          title="Claude Code 配置管理"
          configured={claudeConfigured}
          expanded={expandedAppPanel === 'claude'}
          onToggle={() => setExpandedAppPanel((v) => (v === 'claude' ? null : 'claude'))}
          onConfigure={handleConfigureClaude}
          onRestore={handleRestoreClaudeBackup}
          onUnconfigure={handleUnconfigureClaude}
          actioning={claudeActioning}
          configurable={claudeConfigurable}
          nodes={claudeNodes}
          proxyUrl={claudeProxyUrl}
          tokenVisible={claudeTokenVisible}
          onToggleToken={() => setClaudeTokenVisible((v) => !v)}
          description="用于写入或恢复 `~/.claude/settings.json` 和 `~/.claude.json`。后端会在覆盖前自动创建 `.aastation-backup` 备份文件。"
          envDescription={`将写入变量：\`ANTHROPIC_BASE_URL=${claudeProxyUrl ?? '<待分配端口>'}\`，\`ANTHROPIC_AUTH_TOKEN=${claudeTokenVisible ? authToken : maskedToken}\`。`}
        />

        <AppConfigPanel
          title="OpenCode 配置管理"
          configured={openCodeConfigured}
          expanded={expandedAppPanel === 'opencode'}
          onToggle={() => setExpandedAppPanel((v) => (v === 'opencode' ? null : 'opencode'))}
          onConfigure={handleConfigureOpenCode}
          onRestore={handleRestoreOpenCodeBackup}
          onUnconfigure={handleUnconfigureOpenCode}
          actioning={openCodeActioning}
          configurable={openCodeConfigurable}
          nodes={openCodeNodes}
          proxyUrl={openCodeProxyUrl}
          tokenVisible={openCodeTokenVisible}
          onToggleToken={() => setOpenCodeTokenVisible((v) => !v)}
          description="用于写入或恢复 `~/.config/opencode/opencode.json`。后端会在覆盖前自动创建 `.aastation-backup` 备份文件。"
          envDescription={`将写入：\`provider.aastation.options.baseURL=${openCodeProxyUrl ?? '<待分配端口>'}\`，\`provider.aastation.options.apiKey=${openCodeTokenVisible ? authToken : maskedToken}\`。`}
        />

        <AppConfigPanel
          title="Codex CLI 配置管理"
          configured={codexCliConfigured}
          expanded={expandedAppPanel === 'codex'}
          onToggle={() => setExpandedAppPanel((v) => (v === 'codex' ? null : 'codex'))}
          onConfigure={handleConfigureCodexCli}
          onRestore={handleRestoreCodexCliBackup}
          onUnconfigure={handleUnconfigureCodexCli}
          actioning={codexCliActioning}
          configurable={codexConfigurable}
          nodes={codexCliNodes}
          proxyUrl={codexCliProxyUrl}
          tokenVisible={codexCliTokenVisible}
          onToggleToken={() => setCodexCliTokenVisible((v) => !v)}
          description="用于写入或恢复 `~/.codex/config.toml`。将在配置文件中添加 `[model_providers.aastation]` 和 `[profiles.aastation]` 条目。后端会在覆盖前自动创建 `.aastation-backup` 备份文件。"
          envDescription={`将写入：\`model_providers.aastation.base_url=${codexCliProxyUrl ?? '<待分配端口>'}\`，API Key 环境变量 \`AASTATION_API_KEY=${codexCliTokenVisible ? authToken : maskedToken}\`（存储至 \`~/.codex/aastation_env.txt\`）。写入后请运行：\`codex --profile aastation\` 以使用 AAStation 代理。`}
        />
      </div>
    );
  };

  const renderLogsPanel = () => (
    <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
      <CardContent className="p-5 flex flex-col gap-3.5">
        {/* Header row */}
        <div className="flex justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-foreground m-0">日志</h2>
          <div className="flex gap-2 items-center flex-wrap">
            <Button
              variant={logPaused ? 'accent' : 'secondary'}
              size="sm"
              onClick={() => setLogPaused((p) => !p)}
              className="gap-1.5"
            >
              {logPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {logPaused ? '继续' : '暂停'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleReloadLogs} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> 重新读取
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setLogLines([])} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> 清空视图
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await openLogDir();
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  toast.error(`打开日志目录失败：${msg}`);
                }
              }}
              title={runtimeStatus?.log_dir ?? '日志目录'}
              className="gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" /> 打开目录
            </Button>
          </div>
        </div>

        {/* Privacy notice */}
        <div className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning/8 px-3.5 py-2.5 text-xs leading-relaxed text-warning-foreground">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>隐私提示：</strong>日志文件中包含完整的 AI 请求与响应内容（包括对话记录和 API 地址）。
            日志仅保存于本机，AAStation 不会自动上传。
            <strong>请勿将日志文件分享至互联网或提交给第三方</strong>，以免泄露您的隐私信息。
          </span>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5 text-xs">
          <Card className="rounded-xl border-border bg-surface/65 p-3 shadow-none">
            <div className="text-dim mb-1">后端日志模式</div>
            <div className="text-foreground">
              {runtimeStatus?.mode || '加载中...'}
              {runtimeStatus?.backend_local_read_write ? ' (local rw)' : ''}
            </div>
          </Card>
          <Card className="rounded-xl border-border bg-surface/65 p-3 shadow-none">
            <div className="text-dim mb-1">当前日志文件</div>
            <div className="text-foreground">{logFileName || runtimeStatus?.active_file || '暂无'}</div>
          </Card>
          <Card className="rounded-xl border-border bg-surface/65 p-3 shadow-none">
            <div className="text-dim mb-1">采集状态</div>
            <div className={cn(logError ? "text-destructive" : "text-green-300")}>
              {logError ? `异常: ${logError}` : logPaused ? '已暂停' : logPolling ? '拉取中...' : '运行中'}
            </div>
          </Card>
          <Card className="rounded-xl border-border bg-surface/65 p-3 shadow-none">
            <div className="text-dim mb-1">目录占用 / 上限</div>
            <div className={cn(
              runtimeStatus && runtimeStatus.dir_size_bytes > runtimeStatus.dir_max_bytes * 0.9
                ? "text-destructive"
                : "text-foreground"
            )}>
              {runtimeStatus
                ? `${(runtimeStatus.dir_size_bytes / 1024 / 1024).toFixed(1)} MB / ${(runtimeStatus.dir_max_bytes / 1024 / 1024).toFixed(0)} MB`
                : '加载中...'}
            </div>
          </Card>
        </div>

        {/* Log output */}
        <div
          ref={logScrollerRef}
          onScroll={handleLogScroll}
          className="mt-1 h-[calc(100vh-360px)] min-h-[300px] overflow-auto rounded-xl border border-border bg-surface/35 p-2.5 font-mono text-xs leading-relaxed text-muted whitespace-pre-wrap break-words"
        >
          {logLines.length === 0 ? (
            <div className="text-dim">暂无日志输出...</div>
          ) : (
            logLines.map((line, idx) => (
              <div key={`${idx}-${line.slice(0, 24)}`}>{line}</div>
            ))
          )}
        </div>
        <p className="text-[11px] text-dim">
          已缓存最近 {logLines.length} 行（上限 {LOG_MAX_LINES} 行），轮询间隔 {LOG_POLL_INTERVAL_MS}ms。
          {autoFollow ? ' 当前自动跟随滚动。' : ' 已关闭自动跟随，滚动到底部会自动恢复。'}
          {runtimeStatus?.log_dir ? ` 日志目录：${runtimeStatus.log_dir}` : ''}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="ui-page ui-accent-settings flex flex-1 overflow-hidden">
      <Tabs
        value={subTab}
        onValueChange={(val) => setSubTab(val as SettingsSubTab)}
        orientation="vertical"
        className="flex flex-1"
      >
        <aside className="w-[228px] border-r border-border-soft bg-sidebar-surface/72 p-[28px_14px_22px] flex flex-col gap-2">
          <div className="px-2 pb-3">
            <div className="text-foreground text-base font-bold">设置</div>
          </div>
          <TabsList className="flex flex-col h-auto bg-transparent gap-1 p-0">
            {[
              { key: 'general' as const, title: '常规', desc: '代理监听与鉴权配置' },
              { key: 'applications' as const, title: '应用设置', desc: '用户配置入口与备份恢复' },
              { key: 'logs' as const, title: '日志', desc: '运行时日志实时查看' },
            ].map((item) => (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className="w-full justify-start rounded-xl border border-transparent px-3 py-2.5 text-left data-[state=active]:border-border data-[state=active]:bg-card"
              >
                <div>
                  <div className="text-[13px] font-semibold">{item.title}</div>
                  <div className="text-[11px] mt-0.5 opacity-85">{item.desc}</div>
                </div>
              </TabsTrigger>
            ))}
          </TabsList>
        </aside>

        <main
          className="min-w-0 flex-1 overflow-auto px-6 pb-6"
          style={{
            paddingTop: 'calc(var(--window-controls-safe-top) + 4px)',
            paddingRight: 'calc(var(--window-controls-safe-right) + 12px)',
          }}
        >
          <TabsContent value="general" className="mt-0">
            {renderGeneralPanel()}
          </TabsContent>
          <TabsContent value="applications" className="mt-0">
            {renderApplicationsPanel()}
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            {renderLogsPanel()}
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}
