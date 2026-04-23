import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { publishDag, startProxy, stopProxy, getProxyStatus, isClaudeConfigured } from '../../lib/tauri-api';
import { toast } from '../../store/toast-store';
import ClaudeCodeDialog, { type ClaudeCodeAppInfo } from '../common/ClaudeCodeDialog';
import type { AAStationNode, ApplicationNodeData } from '../../types';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headerStyle: React.CSSProperties = {
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: '#1a1a1a',
  color: '#f9fafb',
  fontSize: 14,
  fontWeight: 600,
  borderBottom: '1px solid #2b2b2b',
  flexShrink: 0,
};

const leftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const statusDotStyle = (running: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: running ? '#22c55e' : '#6b7280',
  boxShadow: running ? '0 0 6px #22c55e80' : 'none',
});

const badgeBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
};

const draftBadge: React.CSSProperties = {
  ...badgeBase,
  background: '#fbbf2430',
  color: '#fbbf24',
  border: '1px solid #fbbf2450',
};

const publishedBadge: React.CSSProperties = {
  ...badgeBase,
  background: '#22c55e25',
  color: '#22c55e',
  border: '1px solid #22c55e40',
};

const rightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const publishBtn: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: '#3b82f6',
  color: '#fff',
};

const publishBtnDisabled: React.CSSProperties = {
  ...publishBtn,
  background: '#475569',
  cursor: 'not-allowed',
};

const toggleBtnBase: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  transition: 'background 0.15s',
};

const toggleBtnOn: React.CSSProperties = {
  ...toggleBtnBase,
  background: '#166534',
  color: '#fff',
};

const toggleBtnOff: React.CSSProperties = {
  ...toggleBtnBase,
  background: '#374151',
  color: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Header() {
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const lastPublishedAt = useAppStore((s) => s.lastPublishedAt);
  const markPublished = useAppStore((s) => s.markPublished);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const getDocument = useFlowStore((s) => s.getDocument);

  const [publishing, setPublishing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claudeCodeDialog, setClaudeCodeDialog] = useState<{
    apps: ClaudeCodeAppInfo[];
    proxyUrl: string;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Toggle proxy on/off (independent of publish)
  // -----------------------------------------------------------------------

  const handleToggleProxy = useCallback(async () => {
    if (toggling) return;

    setToggling(true);
    setError(null);

    try {
      if (proxyStatus.running) {
        await stopProxy();
        toast.success('代理服务已停止');
      } else {
        await startProxy();
        toast.success('代理服务已启动');
      }
      const status = await getProxyStatus();
      setProxyStatus(status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`切换代理服务失败：${msg}`);
      console.error('[Header] Toggle proxy failed:', err);
    } finally {
      setToggling(false);
    }
  }, [proxyStatus.running, toggling, setProxyStatus]);

  const handlePublish = async () => {
    if (publishing) return;

    setPublishing(true);
    setError(null);

    // Track whether publishDag succeeded so we can give a precise error message
    // and avoid resetting "published" state if only the proxy start fails.
    let dagPublished = false;

    try {
      // 1. Publish DAG (validate → compile → hot-load routes)
      const doc = getDocument();
      await publishDag(doc);

      // Mark published immediately after DAG save succeeds — independently of
      // whether the proxy start below will succeed. This prevents the UI from
      // staying in "Draft" state when only the proxy start fails.
      dagPublished = true;
      markPublished();

      // 2. Start proxy server (if not already running)
      if (!proxyStatus.running) {
        await startProxy();
      }

      // 3. Sync proxy status
      const status = await getProxyStatus();
      setProxyStatus(status);

      toast.success('发布并保存成功');
      console.log('[Header] Published and started proxy on port', status.port);

      // 4. Check for Claude Code application nodes
      const claudeCodeApps: ClaudeCodeAppInfo[] = doc.nodes
        .filter((n): n is AAStationNode & { data: ApplicationNodeData } =>
          n.data.nodeType === 'application' && (n.data as ApplicationNodeData).appType === 'claude_code'
        )
        .map((n) => ({
          nodeId: n.id,
          label: n.data.label || 'Claude Code',
          listenPort: n.data.listenPort || 0,
        }));

      if (claudeCodeApps.length > 0) {
        // Only show dialog if Claude Code is not already configured
        const configured = await isClaudeConfigured().catch(() => false);
        if (!configured) {
          const firstApp = claudeCodeApps[0];
          const proxyUrl = `http://127.0.0.1:${firstApp.listenPort}`;
          setClaudeCodeDialog({ apps: claudeCodeApps, proxyUrl });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (dagPublished) {
        // DAG was saved; only the proxy start (or a later step) failed.
        toast.error(`代理启动失败：${msg}`);
        // Best-effort status refresh so the UI reflects the actual proxy state.
        getProxyStatus().then(setProxyStatus).catch(() => {});
      } else {
        toast.error(`发布失败：${msg}`);
      }
      console.error('[Header] Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return null;
    }
  };

  return (
    <header style={headerStyle}>
      <div style={leftStyle}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>AAStation</span>
        {isDraft ? (
          <span style={draftBadge}>Draft</span>
        ) : lastPublishedAt ? (
          <span style={publishedBadge}>
            Published {formatTime(lastPublishedAt)}
          </span>
        ) : null}
      </div>
      <div style={rightStyle}>
        {error && (
          <span
            style={{
              fontSize: 11,
              color: '#f87171',
              maxWidth: 300,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={error}
          >
            {error}
          </span>
        )}
        <button
          style={proxyStatus.running ? toggleBtnOn : toggleBtnOff}
          onClick={handleToggleProxy}
          disabled={toggling}
          title={proxyStatus.running ? '关闭代理' : '开启代理'}
        >
          <span style={statusDotStyle(proxyStatus.running)} />
          {toggling ? '处理中...' : proxyStatus.running ? '关闭代理' : '开启代理'}
        </button>
        <button
          style={publishing ? publishBtnDisabled : isDraft ? publishBtn : publishBtnDisabled}
          onClick={handlePublish}
          disabled={!isDraft || publishing}
        >
          {publishing ? 'Saving...' : '保存'}
        </button>
      </div>

      {/* Claude Code configuration dialog */}
      {claudeCodeDialog && (
        <ClaudeCodeDialog
          apps={claudeCodeDialog.apps}
          proxyUrl={claudeCodeDialog.proxyUrl}
          onClose={() => setClaudeCodeDialog(null)}
        />
      )}
    </header>
  );
}
