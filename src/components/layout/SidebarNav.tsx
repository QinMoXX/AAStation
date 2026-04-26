import { useState, useCallback } from 'react';
import { useNavStore, type NavTab } from '../../store/nav-store';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { publishDag, startProxy, stopProxy, getProxyStatus, isClaudeConfigured } from '../../lib/tauri-api';
import { toast } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// SVG Icon Components
// ---------------------------------------------------------------------------

function HomeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function MonitorIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function SettingsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PowerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  );
}

function UploadIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const navItems: { id: NavTab; icon: React.FC<{ size?: number }>; label: string }[] = [
  { id: 'home', icon: HomeIcon, label: '主页' },
  { id: 'monitor', icon: MonitorIcon, label: '监控' },
  { id: 'settings', icon: SettingsIcon, label: '设置' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SidebarNav() {
  const { activeTab, setTab } = useNavStore();
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const isDraft = useAppStore((s) => s.isDraft);
  const markPublished = useAppStore((s) => s.markPublished);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const getDocument = useFlowStore((s) => s.getDocument);

  const [toggling, setToggling] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // -----------------------------------------------------------------------
  // Toggle proxy on/off
  // -----------------------------------------------------------------------

  const handleToggleProxy = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
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
      toast.error(`切换代理服务失败：${msg}`);
      console.error('[SidebarNav] Toggle proxy failed:', err);
    } finally {
      setToggling(false);
    }
  }, [proxyStatus.running, toggling, setProxyStatus]);

  // -----------------------------------------------------------------------
  // Publish DAG
  // -----------------------------------------------------------------------

  const handlePublish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const doc = getDocument();
      await publishDag(doc);
      if (!proxyStatus.running) {
        await startProxy();
      }
      markPublished();
      const status = await getProxyStatus();
      setProxyStatus(status);
      toast.success('发布并保存成功');

      // Check for Claude Code application nodes
      const claudeCodeApps = doc.nodes
        .filter((n) => n.data.nodeType === 'application' && (n.data as any).appType === 'claude_code')
        .map((n) => n.id);

      if (claudeCodeApps.length > 0) {
        const configured = await isClaudeConfigured().catch(() => false);
        if (!configured) {
          toast.info('检测到 Claude Code 节点，请前往“设置 → 应用设置”进行配置文件写入或备份恢复。', 6000);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`发布或保存失败：${msg}`);
      console.error('[SidebarNav] Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  }, [publishing, proxyStatus.running, getDocument, markPublished, setProxyStatus]);

  return (
    <nav className="ui-sidebar ui-sidebar-primary">
      <div className="ui-sidebar-logo">
        <img src="/logo.svg" alt="AAStation" />
      </div>

      {navItems.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          className={`ui-sidebar-item${activeTab === id ? ' active' : ''}`}
          onClick={() => setTab(id)}
          title={label}
        >
          <Icon size={20} />
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <div className="ui-sidebar-divider" />

      <button
        type="button"
        className="ui-sidebar-action"
        onClick={handlePublish}
        disabled={!isDraft || publishing}
        style={{ color: isDraft && !publishing ? 'var(--ui-muted)' : 'var(--ui-dim)' }}
        title={publishing ? 'Saving...' : '保存'}
      >
        <UploadIcon size={20} />
      </button>

      <button
        type="button"
        className="ui-sidebar-action"
        onClick={handleToggleProxy}
        disabled={toggling}
        style={{ color: proxyStatus.running ? 'var(--ui-success)' : 'var(--ui-muted)' }}
        title={toggling ? '处理中...' : proxyStatus.running ? '关闭代理' : '开启代理'}
      >
        <PowerIcon size={20} />
      </button>

      <div className="ui-sidebar-status">
        <div
          className={`ui-sidebar-status-dot${proxyStatus.running ? ' running' : ''}`}
          title={proxyStatus.running ? `Port ${proxyStatus.port}` : 'Proxy offline'}
        />
        {proxyStatus.running ? (
          <div>
            :{proxyStatus.port}
            <br />
            {proxyStatus.total_requests}req · {formatUptime(proxyStatus.uptime_seconds)}
          </div>
        ) : (
          <div>offline</div>
        )}
      </div>
    </nav>
  );
}
