import { useState, useCallback } from 'react';
import { useNavStore, type NavTab } from '../../store/nav-store';
import { useAppStore } from '../../store/app-store';
import { useFlowStore } from '../../store/flow-store';
import { publishDag, startProxy, stopProxy, getProxyStatus, isClaudeConfigured } from '../../lib/tauri-api';
import { toast } from '../../store/toast-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sidebarStyle: React.CSSProperties = {
  width: 64,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '24px 0 12px',
  gap: 6,
  flexShrink: 0,
};

const logoStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.74))',
  border: '1px solid rgba(255, 255, 255, 0.42)',
  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.56)',
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
  flexShrink: 0,
};

const navItemStyle = (active: boolean): React.CSSProperties => ({
  width: 48,
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 12,
  cursor: 'pointer',
  background: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
  color: active ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.65)',
  transition: 'all 0.15s',
});

const spacerStyle: React.CSSProperties = {
  flex: 1,
};

const dividerStyle: React.CSSProperties = {
  width: 32,
  height: 1,
  background: 'rgba(255, 255, 255, 0.12)',
  margin: '6px 0',
};

const bottomBtnStyle = (active: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  cursor: active ? 'pointer' : 'not-allowed',
  border: 'none',
  background: 'transparent',
  color: active ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.32)',
  transition: 'all 0.15s',
});

const statusDotStyle = (running: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: running ? '#22c55e' : '#6b7280',
  boxShadow: running ? '0 0 6px #22c55e80' : 'none',
  transition: 'all 0.3s',
});

const statusTextStyle: React.CSSProperties = {
  fontSize: 9,
  color: '#6b7280',
  textAlign: 'center',
  lineHeight: 1.2,
  padding: '0 4px',
};

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
    <nav style={sidebarStyle} className="ui-sidebar-primary">
      {/* Logo */}
      <div style={logoStyle}>
        <img src="/logo.svg" alt="AAStation" style={{ width: 32, height: 32 }} />
      </div>

      {/* Navigation items */}
      {navItems.map(({ id, icon: Icon, label }) => (
        <div
          key={id}
          style={navItemStyle(activeTab === id)}
          onClick={() => setTab(id)}
          onMouseEnter={(e) => {
            if (activeTab !== id) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== id) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.65)';
            }
          }}
          title={label}
        >
          <Icon size={20} />
        </div>
      ))}

      <div style={spacerStyle} />

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Publish button */}
      <button
        style={bottomBtnStyle(isDraft && !publishing)}
        onClick={handlePublish}
        disabled={!isDraft || publishing}
        title={publishing ? 'Saving...' : '保存'}
        onMouseEnter={(e) => {
          if (isDraft && !publishing) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.92)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color =
            isDraft && !publishing ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.32)';
        }}
      >
        <UploadIcon size={20} />
      </button>

      {/* Toggle proxy button */}
      <button
        style={{
          ...bottomBtnStyle(true),
          color: proxyStatus.running ? '#22c55e' : '#9ca3af',
        }}
        onClick={handleToggleProxy}
        disabled={toggling}
        title={toggling ? '...' : proxyStatus.running ? 'Stop proxy' : 'Start proxy'}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = proxyStatus.running ? '#7f1d1d40' : '#16653440';
          e.currentTarget.style.color = proxyStatus.running ? '#f87171' : '#4ade80';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = proxyStatus.running ? '#22c55e' : '#9ca3af';
        }}
      >
        <PowerIcon size={20} />
      </button>

      {/* Status dot + info */}
      <div style={statusDotStyle(proxyStatus.running)} title={proxyStatus.running ? `Port ${proxyStatus.port}` : 'Proxy offline'} />
      {proxyStatus.running ? (
        <div style={statusTextStyle}>
          :{proxyStatus.port}
          <br />
          {proxyStatus.total_requests}req · {formatUptime(proxyStatus.uptime_seconds)}
        </div>
      ) : (
        <div style={statusTextStyle}>offline</div>
      )}

    </nav>
  );
}
