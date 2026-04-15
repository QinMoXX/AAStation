import { useCallback } from 'react';
import { useFlowStore, PRESET_PROVIDERS } from '../../store/flow-store';
import { useNavStore } from '../../store/nav-store';
import { getProviderIcon, CustomProviderIcon } from '../icons/ProviderIcons';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  width: 256,
  height: '100%',
  background: '#f9fafb',
  borderRight: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  overflowY: 'auto',
};

const panelHeaderStyle: React.CSSProperties = {
  padding: '20px 24px 16px',
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#111827',
  marginBottom: 12,
};

const tabRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  marginBottom: 4,
};

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px 0',
  fontSize: 12,
  fontWeight: active ? 600 : 500,
  border: 'none',
  borderRadius: 6,
  background: active ? '#fff' : 'transparent',
  color: active ? '#111827' : '#6b7280',
  cursor: 'pointer',
  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
  transition: 'all 0.15s',
});

const sectionStyle: React.CSSProperties = {
  padding: '4px 12px',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '8px 12px 4px',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  fontSize: 13,
  color: '#374151',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'background 0.15s',
  gap: 8,
};

const itemHoverBg = '#e5e7eb';

const itemCountStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Provider Panel Content
// ---------------------------------------------------------------------------

function ProviderPanelContent() {
  const addNode = useFlowStore((s) => s.addNode);
  const addPresetProviderNode = useFlowStore((s) => s.addPresetProviderNode);

  const handleAddPreset = useCallback(
    (presetId: string) => {
      addPresetProviderNode(presetId);
    },
    [addPresetProviderNode]
  );

  const handleAddCustom = useCallback(() => {
    addNode('provider');
  }, [addNode]);

  return (
    <>
      <div style={sectionHeaderStyle}>预设 Providers</div>
      <div style={sectionStyle}>
        {PRESET_PROVIDERS.map((preset) => {
          const Icon = getProviderIcon(preset.icon);
          return (
            <div
              key={preset.id}
              style={itemStyle}
              onClick={() => handleAddPreset(preset.id)}
              onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
                  {Icon && <Icon style={{ width: 16, height: 16 }} />}
                </span>
                <span style={{ fontWeight: 500 }}>{preset.name}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={sectionHeaderStyle}>自定义</div>
      <div style={sectionStyle}>
        <div
          style={itemStyle}
          onClick={handleAddCustom}
          onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
              <CustomProviderIcon style={{ width: 16, height: 16 }} />
            </span>
            <span style={{ fontWeight: 500 }}>Custom Provider</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Middleware Panel Content
// ---------------------------------------------------------------------------

function MiddlewarePanelContent() {
  const addNode = useFlowStore((s) => s.addNode);
  const nodes = useFlowStore((s) => s.nodes);

  const switcherCount = nodes.filter((n) => n.data.nodeType === 'switcher').length;

  const handleAddSwitcher = useCallback(() => {
    addNode('switcher');
  }, [addNode]);

  return (
    <>
      <div style={sectionHeaderStyle}>中间件类型</div>
      <div style={sectionStyle}>
        <div
          style={itemStyle}
          onClick={handleAddSwitcher}
          onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m15 9 6-6" />
            </svg>
            <span style={{ fontWeight: 500 }}>Switcher</span>
          </div>
          {switcherCount > 0 && <span style={itemCountStyle}>{switcherCount}</span>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Application Panel Content
// ---------------------------------------------------------------------------

function ApplicationPanelContent() {
  const addNode = useFlowStore((s) => s.addNode);
  const nodes = useFlowStore((s) => s.nodes);

  const appCount = nodes.filter((n) => n.data.nodeType === 'application').length;

  const handleAddApplication = useCallback(() => {
    addNode('application');
  }, [addNode]);

  return (
    <>
      <div style={sectionHeaderStyle}>应用类型</div>
      <div style={sectionStyle}>
        <div
          style={itemStyle}
          onClick={handleAddApplication}
          onMouseEnter={(e) => { e.currentTarget.style.background = itemHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            <span style={{ fontWeight: 500 }}>自定义监听</span>
          </div>
          {appCount > 0 && <span style={itemCountStyle}>{appCount}</span>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeSubNav() {
  const { homeSubTab, setHomeSubTab } = useNavStore();

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle} data-tauri-drag-region>
        <h2 style={panelTitleStyle}>节点组件</h2>
        <div style={tabRowStyle}>
          <button
            style={tabBtnStyle(homeSubTab === 'provider')}
            onClick={() => setHomeSubTab('provider')}
          >
            Provider
          </button>
          <button
            style={tabBtnStyle(homeSubTab === 'middleware')}
            onClick={() => setHomeSubTab('middleware')}
          >
            Middleware
          </button>
          <button
            style={tabBtnStyle(homeSubTab === 'application')}
            onClick={() => setHomeSubTab('application')}
          >
            App
          </button>
        </div>
      </div>

      {homeSubTab === 'provider' && <ProviderPanelContent />}
      {homeSubTab === 'middleware' && <MiddlewarePanelContent />}
      {homeSubTab === 'application' && <ApplicationPanelContent />}
    </div>
  );
}
