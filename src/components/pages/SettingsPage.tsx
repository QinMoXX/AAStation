import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { useFlowStore } from '../../store/flow-store';
import { toast } from '../../store/toast-store';
import {
  checkAndMaybeInstallUpdate,
  configureClaudeCode,
  configureCodexCli,
  configureOpenCode,
  getLogRuntimeStatus,
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

type SettingsSubTab = 'general' | 'applications' | 'logs';

const LOG_POLL_INTERVAL_MS = 1200;
const LOG_MAX_LINES = 1200;

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
};

const subSidebarStyle: React.CSSProperties = {
  width: 228,
  padding: '34px 14px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '36px 24px 24px',
};

const cardStyle: React.CSSProperties = {};

const fieldStyle: React.CSSProperties = {
  marginBottom: 18,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ui-muted)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const subTabs: { key: SettingsSubTab; title: string; desc: string }[] = [
  { key: 'general', title: '常规', desc: '代理监听与鉴权配置' },
  { key: 'applications', title: '应用设置', desc: '用户配置入口与备份恢复' },
  { key: 'logs', title: '日志', desc: '运行时日志实时查看' },
];

export default function SettingsPage() {
  const { settings, saveSettings } = useSettingsStore();
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
  const [autoInstallUpdate, setAutoInstallUpdate] = useState(settings.autoInstallUpdate);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPortRange(settings.listenPortRange);
    setAddress(settings.listenAddress);
    setLogDirMaxMb(String(settings.logDirMaxMb ?? 500));
    setLaunchAtStartup(settings.launchAtStartup);
    setAutoCheckUpdate(settings.autoCheckUpdate);
    setAutoInstallUpdate(settings.autoInstallUpdate);
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
        autoInstallUpdate,
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

  const handleManualUpdateCheck = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await checkAndMaybeInstallUpdate(autoInstallUpdate);
      if (!result.hasUpdate) {
        toast.info(`当前已是最新版本（${result.currentVersion}）`);
        return;
      }
      if (result.installed) {
        toast.success(`检测到新版本 ${result.latestVersion}，已安装并准备重启。`);
        return;
      }
      toast.info(`检测到新版本 ${result.latestVersion}，请开启“自动下载并安装更新”后重试。`);
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

  // -----------------------------------------------------------------------
  // OpenCode config actions
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Codex CLI config actions
  // -----------------------------------------------------------------------

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

  const renderGeneralPanel = () => (
    <div className="ui-card" style={{ ...cardStyle, maxWidth: 860, padding: 24 }}>
      <h2 style={{ fontSize: 22, color: '#f8fafc', margin: '0 0 16px' }}>常规设置</h2>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 22 }}>
        用于配置代理监听地址、端口范围和代理认证令牌展示。
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>监听端口范围</label>
        <input
          type="text"
          value={portRange}
          placeholder="9527-9537"
          onChange={(e) => setPortRange(e.target.value)}
          className="ui-input"
          style={inputStyle}
        />
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          单端口示例: 9527；范围示例: 9527-9537。发布时会从该范围内分配应用端口。
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>绑定地址</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="ui-input"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>
          日志目录大小上限（MB）
        </label>
        <input
          type="number"
          min={1}
          value={logDirMaxMb}
          onChange={(e) => setLogDirMaxMb(e.target.value)}
          className="ui-input"
          style={{ ...inputStyle, width: 180 }}
        />
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          软件启动时若日志目录总大小超过此值，将自动从最旧的文件开始删除。默认 500 MB。
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>系统启动</label>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            color: '#e2e8f0',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={launchAtStartup}
            onChange={(e) => setLaunchAtStartup(e.target.checked)}
          />
          开机自启动
        </label>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          勾选后会在系统启动时自动启动 AAStation。
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>自动更新</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
              color: '#e2e8f0',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={autoCheckUpdate}
              onChange={(e) => setAutoCheckUpdate(e.target.checked)}
            />
            启动时自动检查更新
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
              color: '#e2e8f0',
              cursor: autoCheckUpdate ? 'pointer' : 'not-allowed',
              opacity: autoCheckUpdate ? 1 : 0.66,
            }}
          >
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={autoInstallUpdate}
              disabled={!autoCheckUpdate}
              onChange={(e) => setAutoInstallUpdate(e.target.checked)}
            />
            发现更新后自动下载并安装
          </label>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            版本来源为 GitHub Releases，安装前会做签名校验。Windows 下安装时可能触发系统安装器窗口。
          </div>
          <div>
            <button
              onClick={handleManualUpdateCheck}
              disabled={checkingUpdate}
              className="ui-btn"
              style={{ ...buttonBaseStyle, padding: '7px 12px', fontSize: 12 }}
            >
              {checkingUpdate ? '检查中...' : '立即检查更新'}
            </button>
          </div>
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>
          代理认证令牌
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
            只读 · 客户端通过此令牌向代理认证
          </span>
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type={tokenVisible ? 'text' : 'password'}
            value={tokenVisible ? authToken : maskedToken}
            readOnly
            className="ui-input"
            style={{
              ...inputStyle,
              flex: 1,
              color: tokenVisible ? '#f9fafb' : '#6b7280',
              cursor: 'default',
              userSelect: 'all',
            }}
          />
          <button
            onClick={() => setTokenVisible(!tokenVisible)}
            className="ui-btn"
            style={buttonBaseStyle}
          >
            {tokenVisible ? '隐藏' : '显示'}
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(authToken);
              toast.success('令牌已复制');
            }}
            className="ui-btn"
            style={buttonBaseStyle}
          >
            复制
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <button
          onClick={handleSaveGeneral}
          disabled={saving}
          className="ui-btn ui-btn-primary"
          style={{
            ...buttonBaseStyle,
            minWidth: 120,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  );

  const renderApplicationsPanel = () => {
    const claudeExpandable = expandedAppPanel === 'claude';
    const openCodeExpandable = expandedAppPanel === 'opencode';
    const codexExpandable = expandedAppPanel === 'codex';
    const claudeConfigurable = claudeNodes.length > 0 && !!claudeProxyUrl;
    const openCodeConfigurable = openCodeNodes.length > 0 && !!openCodeProxyUrl;
    const codexConfigurable = codexCliNodes.length > 0 && !!codexCliProxyUrl;

    const statusBadgeStyle = (configured: boolean): React.CSSProperties => ({
      position: 'absolute',
      top: 14,
      right: 48,
      fontSize: 12,
      borderRadius: 999,
      padding: '3px 10px',
      border: configured ? '1px solid rgba(34, 197, 94, 0.36)' : '1px solid rgba(255, 255, 255, 0.14)',
      background: configured ? 'rgba(34, 197, 94, 0.14)' : 'rgba(255, 255, 255, 0.08)',
      color: configured ? '#22c55e' : '#cbd5e1',
    });

    const briefBoxStyle: React.CSSProperties = {
      borderRadius: 10,
      padding: 12,
      border: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(2, 6, 23, 0.38)',
    };

    const expandIconStyle = (expanded: boolean): React.CSSProperties => ({
      position: 'absolute',
      top: 14,
      right: 14,
      fontSize: 20,
      color: '#94a3b8',
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease',
      lineHeight: 1,
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 22, color: '#f8fafc', margin: 0 }}>应用设置</h2>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>
              集中管理需要修改用户本地配置文件的应用能力，并提供备份恢复入口。
            </div>
          </div>
          <button
            onClick={refreshClaudeConfigStatus}
            disabled={claudeLoading || claudeActioning}
            className="ui-btn"
            style={buttonBaseStyle}
          >
            {claudeLoading ? '状态刷新中...' : '刷新配置状态'}
          </button>
        </div>

        <div className="ui-card" style={{ ...cardStyle, padding: 16, position: 'relative' }}>
          <div style={statusBadgeStyle(claudeConfigured)}>
            {claudeConfigured ? '已配置' : '未配置'}
          </div>
          <button
            onClick={() => setExpandedAppPanel((v) => (v === 'claude' ? null : 'claude'))}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              paddingRight: 140,
            }}
          >
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700, minHeight: 24 }}>Claude Code 配置管理</div>
            <span style={expandIconStyle(claudeExpandable)} aria-hidden="true">›</span>
          </button>

          {claudeExpandable && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
                用于写入或恢复 `~/.claude/settings.json` 和 `~/.claude.json`。
                后端会在覆盖前自动创建 `.aastation-backup` 备份文件。
              </div>

              <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>检测到 Claude Code 节点</div>
                  <div style={{ fontSize: 20, color: '#e2e8f0', fontWeight: 700, marginTop: 4 }}>{claudeNodes.length}</div>
                </div>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>配置代理地址</div>
                  <div style={{ fontSize: 13, color: 'var(--ui-text)', marginTop: 4 }}>
                    {claudeProxyUrl ?? '暂无可用端口'}
                  </div>
                </div>
              </div>

              {claudeNodes.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {claudeNodes.map((node) => {
                    const data = node.data as ApplicationNodeData;
                    return (
                      <div
                        key={node.id}
                        style={{
                          fontSize: 12,
                          color: 'var(--ui-text)',
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'rgba(0, 0, 0, 0.28)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        {data.label} · {node.id} · 端口 :{data.listenPort || 0}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', lineHeight: 1.65 }}>
                将写入变量：`ANTHROPIC_BASE_URL={claudeProxyUrl ?? '<待分配端口>'}`，
                `ANTHROPIC_AUTH_TOKEN={claudeTokenVisible ? authToken : maskedToken}`。
              </div>
              <button
                onClick={() => setClaudeTokenVisible((v) => !v)}
                className="ui-btn"
                style={{ ...buttonBaseStyle, marginTop: 8, padding: '6px 10px', fontSize: 12 }}
              >
                {claudeTokenVisible ? '隐藏令牌展示' : '显示令牌展示'}
              </button>

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleConfigureClaude}
                  disabled={claudeActioning || !claudeConfigurable}
                  className="ui-btn ui-btn-primary"
                  style={{
                    ...buttonBaseStyle,
                    cursor: claudeActioning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {claudeActioning ? '处理中...' : '一键写入配置'}
                </button>
                <button
                  onClick={handleRestoreClaudeBackup}
                  disabled={claudeActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  从备份恢复
                </button>
                <button
                  onClick={handleUnconfigureClaude}
                  disabled={claudeActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  移除托管配置
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ui-card" style={{ ...cardStyle, padding: 16, position: 'relative' }}>
          <div style={statusBadgeStyle(openCodeConfigured)}>
            {openCodeConfigured ? '已配置' : '未配置'}
          </div>
          <button
            onClick={() => setExpandedAppPanel((v) => (v === 'opencode' ? null : 'opencode'))}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              paddingRight: 140,
            }}
          >
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700, minHeight: 24 }}>OpenCode 配置管理</div>
            <span style={expandIconStyle(openCodeExpandable)} aria-hidden="true">›</span>
          </button>

          {openCodeExpandable && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
                用于写入或恢复 `~/.config/opencode/opencode.json`。
                后端会在覆盖前自动创建 `.aastation-backup` 备份文件。
              </div>

              <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>检测到 OpenCode 节点</div>
                  <div style={{ fontSize: 20, color: '#e2e8f0', fontWeight: 700, marginTop: 4 }}>{openCodeNodes.length}</div>
                </div>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>配置代理地址</div>
                  <div style={{ fontSize: 13, color: 'var(--ui-text)', marginTop: 4 }}>
                    {openCodeProxyUrl ?? '暂无可用端口'}
                  </div>
                </div>
              </div>

              {openCodeNodes.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {openCodeNodes.map((node) => {
                    const data = node.data as ApplicationNodeData;
                    return (
                      <div
                        key={node.id}
                        style={{
                          fontSize: 12,
                          color: 'var(--ui-text)',
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'rgba(0, 0, 0, 0.28)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        {data.label} · {node.id} · 端口 :{data.listenPort || 0}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', lineHeight: 1.65 }}>
                将写入：`provider.aastation.options.baseURL={openCodeProxyUrl ?? '<待分配端口>'}`，
                `provider.aastation.options.apiKey={openCodeTokenVisible ? authToken : maskedToken}`。
              </div>
              <button
                onClick={() => setOpenCodeTokenVisible((v) => !v)}
                className="ui-btn"
                style={{ ...buttonBaseStyle, marginTop: 8, padding: '6px 10px', fontSize: 12 }}
              >
                {openCodeTokenVisible ? '隐藏令牌展示' : '显示令牌展示'}
              </button>

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleConfigureOpenCode}
                  disabled={openCodeActioning || !openCodeConfigurable}
                  className="ui-btn ui-btn-primary"
                  style={{
                    ...buttonBaseStyle,
                    cursor: openCodeActioning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {openCodeActioning ? '处理中...' : '一键写入配置'}
                </button>
                <button
                  onClick={handleRestoreOpenCodeBackup}
                  disabled={openCodeActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  从备份恢复
                </button>
                <button
                  onClick={handleUnconfigureOpenCode}
                  disabled={openCodeActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  移除托管配置
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ui-card" style={{ ...cardStyle, padding: 16, position: 'relative' }}>
          <div style={statusBadgeStyle(codexCliConfigured)}>
            {codexCliConfigured ? '已配置' : '未配置'}
          </div>
          <button
            onClick={() => setExpandedAppPanel((v) => (v === 'codex' ? null : 'codex'))}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              paddingRight: 140,
            }}
          >
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700, minHeight: 24 }}>Codex CLI 配置管理</div>
            <span style={expandIconStyle(codexExpandable)} aria-hidden="true">›</span>
          </button>

          {codexExpandable && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
                用于写入或恢复 `~/.codex/config.toml`。
                将在配置文件中添加 `[model_providers.aastation]` 和 `[profiles.aastation]` 条目。
                后端会在覆盖前自动创建 `.aastation-backup` 备份文件。
              </div>

              <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>检测到 Codex CLI 节点</div>
                  <div style={{ fontSize: 20, color: '#e2e8f0', fontWeight: 700, marginTop: 4 }}>{codexCliNodes.length}</div>
                </div>
                <div style={briefBoxStyle}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>配置代理地址</div>
                  <div style={{ fontSize: 13, color: 'var(--ui-text)', marginTop: 4 }}>
                    {codexCliProxyUrl ?? '暂无可用端口'}
                  </div>
                </div>
              </div>

              {codexCliNodes.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {codexCliNodes.map((node) => {
                    const data = node.data as ApplicationNodeData;
                    return (
                      <div
                        key={node.id}
                        style={{
                          fontSize: 12,
                          color: 'var(--ui-text)',
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'rgba(0, 0, 0, 0.28)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        {data.label} · {node.id} · 端口 :{data.listenPort || 0}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', lineHeight: 1.65 }}>
                将写入：`model_providers.aastation.base_url={codexCliProxyUrl ?? '<待分配端口>'}`，
                API Key 环境变量 `AASTATION_API_KEY={codexCliTokenVisible ? authToken : maskedToken}`（存储至 `~/.codex/aastation_env.txt`）。
                <br />
                写入后请运行：<code style={{ color: '#a78bfa' }}>codex --profile aastation</code> 以使用 AAStation 代理。
              </div>
              <button
                onClick={() => setCodexCliTokenVisible((v) => !v)}
                className="ui-btn"
                style={{ ...buttonBaseStyle, marginTop: 8, padding: '6px 10px', fontSize: 12 }}
              >
                {codexCliTokenVisible ? '隐藏令牌展示' : '显示令牌展示'}
              </button>

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleConfigureCodexCli}
                  disabled={codexCliActioning || !codexConfigurable}
                  className="ui-btn ui-btn-primary"
                  style={{
                    ...buttonBaseStyle,
                    cursor: codexCliActioning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {codexCliActioning ? '处理中...' : '一键写入配置'}
                </button>
                <button
                  onClick={handleRestoreCodexCliBackup}
                  disabled={codexCliActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  从备份恢复
                </button>
                <button
                  onClick={handleUnconfigureCodexCli}
                  disabled={codexCliActioning}
                  className="ui-btn"
                  style={buttonBaseStyle}
                >
                  移除托管配置
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLogsPanel = () => (
    <div className="ui-card" style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, color: '#f8fafc', margin: 0 }}>日志</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setLogPaused((p) => !p)}
            className={logPaused ? 'ui-btn ui-btn-active' : 'ui-btn'}
            style={{ ...buttonBaseStyle }}
          >
            {logPaused ? '继续' : '暂停'}
          </button>
          <button onClick={handleReloadLogs} className="ui-btn" style={buttonBaseStyle}>重新读取</button>
          <button onClick={() => setLogLines([])} className="ui-btn" style={buttonBaseStyle}>清空视图</button>
          <button
            onClick={async () => {
              try {
                await openLogDir();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                toast.error(`打开日志目录失败：${msg}`);
              }
            }}
            className="ui-btn"
            style={buttonBaseStyle}
            title={runtimeStatus?.log_dir ?? '日志目录'}
          >
            📂 打开目录
          </button>
        </div>
      </div>

      {/* Privacy notice banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(251, 191, 36, 0.08)',
          border: '1px solid rgba(251, 191, 36, 0.28)',
          fontSize: 12,
          color: '#fcd34d',
          lineHeight: 1.65,
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠️</span>
        <span>
          <strong>隐私提示：</strong>日志文件中包含完整的 AI 请求与响应内容（包括对话记录和 API 地址）。
          日志仅保存于本机，AAStation 不会自动上传。
          <strong>请勿将日志文件分享至互联网或提交给第三方</strong>，以免泄露您的隐私信息。
        </span>
      </div>

      {/* Status cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 10,
          fontSize: 12,
        }}
      >
        <div className="ui-card" style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>后端日志模式</div>
          <div style={{ color: '#e2e8f0' }}>
            {runtimeStatus?.mode || '加载中...'}
            {runtimeStatus?.backend_local_read_write ? ' (local rw)' : ''}
          </div>
        </div>
        <div className="ui-card" style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>当前日志文件</div>
          <div style={{ color: '#e2e8f0' }}>{logFileName || runtimeStatus?.active_file || '暂无'}</div>
        </div>
        <div className="ui-card" style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>采集状态</div>
          <div style={{ color: logError ? '#fca5a5' : '#86efac' }}>
            {logError ? `异常: ${logError}` : logPaused ? '已暂停' : logPolling ? '拉取中...' : '运行中'}
          </div>
        </div>
        <div className="ui-card" style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>目录占用 / 上限</div>
          <div style={{ color: runtimeStatus && runtimeStatus.dir_size_bytes > runtimeStatus.dir_max_bytes * 0.9 ? '#fca5a5' : '#e2e8f0' }}>
            {runtimeStatus
              ? `${(runtimeStatus.dir_size_bytes / 1024 / 1024).toFixed(1)} MB / ${(runtimeStatus.dir_max_bytes / 1024 / 1024).toFixed(0)} MB`
              : '加载中...'}
          </div>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={logScrollerRef}
        onScroll={handleLogScroll}
        style={{
          marginTop: 4,
          height: 'calc(100vh - 360px)',
          minHeight: 300,
          overflow: 'auto',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'rgba(0, 0, 0, 0.28)',
          fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
          fontSize: 12,
          lineHeight: 1.65,
          color: '#cbd5e1',
          padding: '10px 12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {logLines.length === 0 ? (
          <div style={{ color: '#64748b' }}>暂无日志输出...</div>
        ) : (
          logLines.map((line, idx) => (
            <div key={`${idx}-${line.slice(0, 24)}`}>{line}</div>
          ))
        )}
      </div>
      <div style={{ fontSize: 11, color: '#64748b' }}>
        已缓存最近 {logLines.length} 行（上限 {LOG_MAX_LINES} 行），轮询间隔 {LOG_POLL_INTERVAL_MS}ms。
        {autoFollow ? ' 当前自动跟随滚动。' : ' 已关闭自动跟随，滚动到底部会自动恢复。'}
        {runtimeStatus?.log_dir ? ` 日志目录：${runtimeStatus.log_dir}` : ''}
      </div>
    </div>
  );

  return (
    <div style={pageStyle} className="ui-page ui-accent-settings">
      <aside style={subSidebarStyle} className="ui-subsidebar">
        <div style={{ padding: '4px 8px 12px' }}>
          <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700 }}>设置</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
            二级菜单
          </div>
        </div>
        {subTabs.map((item) => {
          const active = subTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setSubTab(item.key)}
              className={active ? 'ui-subtab ui-subtab-active' : 'ui-subtab'}
              style={{
                textAlign: 'left',
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>{item.desc}</div>
            </button>
          );
        })}
      </aside>

      <main style={contentAreaStyle}>
        {subTab === 'general' && renderGeneralPanel()}
        {subTab === 'applications' && renderApplicationsPanel()}
        {subTab === 'logs' && renderLogsPanel()}
      </main>
    </div>
  );
}
