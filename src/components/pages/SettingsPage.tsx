import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { useFlowStore } from '../../store/flow-store';
import { toast } from '../../store/toast-store';
import {
  configureClaudeCode,
  getLogRuntimeStatus,
  isClaudeConfigured,
  pollRuntimeLogs,
  restoreClaudeConfig,
  type LogRuntimeStatus,
  unconfigureClaudeCode,
} from '../../lib/tauri-api';
import type { ApplicationNodeData } from '../../types';

type SettingsSubTab = 'general' | 'applications' | 'logs';

const LOG_POLL_INTERVAL_MS = 1200;
const LOG_MAX_LINES = 1200;

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  background:
    'radial-gradient(circle at top left, rgba(59,130,246,0.1), transparent 24%), linear-gradient(180deg, #0b1220 0%, #111827 100%)',
  overflow: 'hidden',
};

const subSidebarStyle: React.CSSProperties = {
  width: 228,
  borderRight: '1px solid rgba(148, 163, 184, 0.14)',
  background: 'rgba(10, 15, 28, 0.82)',
  padding: '22px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(17, 24, 39, 0.78)',
  border: '1px solid rgba(148, 163, 184, 0.15)',
  borderRadius: 16,
  boxShadow: '0 16px 36px rgba(0,0,0,0.24)',
  backdropFilter: 'blur(10px)',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 18,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#d1d5db',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  background: '#0f172a',
  color: '#f9fafb',
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  background: '#111827',
  color: '#cbd5e1',
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
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPortRange(settings.listenPortRange);
    setAddress(settings.listenAddress);
  }, [settings]);

  const handleSaveGeneral = async () => {
    setSaving(true);
    try {
      await saveSettings({
        listenPortRange: portRange,
        listenAddress: address,
        proxyAuthToken: settings.proxyAuthToken,
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

  const claudeNodes = useMemo(
    () => applicationNodes.filter((n) => (n.data as ApplicationNodeData).appType === 'claude_code'),
    [applicationNodes],
  );

  const claudeProxyUrl = useMemo(() => {
    const valid = claudeNodes
      .map((n) => n.data as ApplicationNodeData)
      .find((d) => Number.isInteger(d.listenPort) && d.listenPort > 0);
    return valid ? `http://127.0.0.1:${valid.listenPort}` : null;
  }, [claudeNodes]);

  const refreshClaudeConfigStatus = useCallback(async () => {
    setClaudeLoading(true);
    try {
      const configured = await isClaudeConfigured();
      setClaudeConfigured(configured);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`读取 Claude Code 配置状态失败：${msg}`);
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
    <div style={{ ...cardStyle, maxWidth: 860, padding: 24 }}>
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
          style={inputStyle}
        />
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
            style={buttonBaseStyle}
          >
            {tokenVisible ? '隐藏' : '显示'}
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(authToken);
              toast.success('令牌已复制');
            }}
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
          style={{
            ...buttonBaseStyle,
            minWidth: 120,
            border: 'none',
            background: saving ? '#3b82f680' : '#3b82f6',
            color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  );

  const renderApplicationsPanel = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...cardStyle, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 22, color: '#f8fafc', margin: 0 }}>应用设置</h2>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>
              集中管理需要修改用户本地配置文件的应用能力，并提供备份恢复入口。
            </div>
          </div>
          <button
            onClick={refreshClaudeConfigStatus}
            disabled={claudeLoading || claudeActioning}
            style={buttonBaseStyle}
          >
            {claudeLoading ? '状态刷新中...' : '刷新配置状态'}
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            borderRadius: 12,
            border: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'rgba(15, 23, 42, 0.72)',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700 }}>Claude Code 配置管理</div>
              <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                用于写入或恢复 `~/.claude/settings.json` 和 `~/.claude.json`。
                后端会在覆盖前自动创建 `.aastation-backup` 备份文件。
              </div>
            </div>
            <div
              style={{
                alignSelf: 'flex-start',
                fontSize: 12,
                color: claudeConfigured ? '#86efac' : '#fcd34d',
                background: claudeConfigured ? '#052e16' : '#422006',
                borderRadius: 999,
                padding: '4px 10px',
              }}
            >
              {claudeConfigured ? '已配置' : '未配置'}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            <div style={{ ...cardStyle, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>检测到 Claude Code 节点</div>
              <div style={{ fontSize: 20, color: '#e2e8f0', fontWeight: 700, marginTop: 4 }}>{claudeNodes.length}</div>
            </div>
            <div style={{ ...cardStyle, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>配置代理地址</div>
              <div style={{ fontSize: 13, color: '#93c5fd', marginTop: 4 }}>
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
                      color: '#cbd5e1',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#020617',
                      border: '1px solid rgba(148, 163, 184, 0.14)',
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
            style={{ ...buttonBaseStyle, marginTop: 8, padding: '6px 10px', fontSize: 12 }}
          >
            {claudeTokenVisible ? '隐藏令牌展示' : '显示令牌展示'}
          </button>

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleConfigureClaude}
              disabled={claudeActioning || claudeNodes.length === 0 || !claudeProxyUrl}
              style={{
                ...buttonBaseStyle,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: claudeActioning ? 'not-allowed' : 'pointer',
              }}
            >
              {claudeActioning ? '处理中...' : '一键写入配置'}
            </button>
            <button
              onClick={handleRestoreClaudeBackup}
              disabled={claudeActioning}
              style={{
                ...buttonBaseStyle,
                border: '1px solid rgba(110,231,183,0.35)',
                color: '#a7f3d0',
                background: '#052e16aa',
              }}
            >
              从备份恢复
            </button>
            <button
              onClick={handleUnconfigureClaude}
              disabled={claudeActioning}
              style={{
                ...buttonBaseStyle,
                border: '1px solid rgba(248,113,113,0.35)',
                color: '#fecaca',
                background: '#450a0a66',
              }}
            >
              移除托管配置
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLogsPanel = () => (
    <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, color: '#f8fafc', margin: 0 }}>日志</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8, lineHeight: 1.6 }}>
            前端仅负责获取与展示日志，后端在本地执行日志文件读写与增量读取，降低前端 I/O 压力。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setLogPaused((p) => !p)}
            style={{
              ...buttonBaseStyle,
              border: 'none',
              background: logPaused ? '#065f46' : '#1f2937',
              color: '#ecfeff',
            }}
          >
            {logPaused ? '继续' : '暂停'}
          </button>
          <button onClick={handleReloadLogs} style={buttonBaseStyle}>重新读取</button>
          <button onClick={() => setLogLines([])} style={buttonBaseStyle}>清空视图</button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 10,
          fontSize: 12,
        }}
      >
        <div style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>后端日志模式</div>
          <div style={{ color: '#e2e8f0' }}>
            {runtimeStatus?.mode || '加载中...'}
            {runtimeStatus?.backend_local_read_write ? ' (local rw)' : ''}
          </div>
        </div>
        <div style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>当前日志文件</div>
          <div style={{ color: '#e2e8f0' }}>{logFileName || runtimeStatus?.active_file || '暂无'}</div>
        </div>
        <div style={{ ...cardStyle, padding: 12, borderRadius: 10 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>采集状态</div>
          <div style={{ color: logError ? '#fca5a5' : '#86efac' }}>
            {logError ? `异常: ${logError}` : logPaused ? '已暂停' : logPolling ? '拉取中...' : '运行中'}
          </div>
        </div>
      </div>

      <div
        ref={logScrollerRef}
        onScroll={handleLogScroll}
        style={{
          marginTop: 4,
          height: 'calc(100vh - 290px)',
          minHeight: 360,
          overflow: 'auto',
          borderRadius: 12,
          border: '1px solid rgba(148, 163, 184, 0.2)',
          background: '#020617',
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
      </div>
    </div>
  );

  return (
    <div style={pageStyle}>
      <aside style={subSidebarStyle}>
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
              style={{
                textAlign: 'left',
                borderRadius: 10,
                border: active ? '1px solid rgba(96,165,250,0.6)' : '1px solid transparent',
                background: active ? '#1d4ed840' : 'transparent',
                color: active ? '#e2e8f0' : '#9ca3af',
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
