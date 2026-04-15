import { useNavStore, type NavTab } from '../../store/nav-store';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sidebarStyle: React.CSSProperties = {
  width: 56,
  height: '100%',
  background: '#1e293b',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '12px 0',
  gap: 8,
  flexShrink: 0,
};

const navItemStyle = (active: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  cursor: 'pointer',
  background: active ? '#334155' : 'transparent',
  color: active ? '#f1f5f9' : '#94a3b8',
  fontSize: 20,
  transition: 'all 0.15s',
});

const navItemHoverStyle: React.CSSProperties = {
  background: '#334155',
  color: '#f1f5f9',
};

const navItems: { id: NavTab; icon: string; label: string }[] = [
  { id: 'home', icon: '🏠', label: '主页' },
  { id: 'monitor', icon: '📊', label: '监控' },
  { id: 'settings', icon: '⚙️', label: '设置' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SidebarNav() {
  const { activeTab, setTab } = useNavStore();

  return (
    <nav style={sidebarStyle}>
      {navItems.map(({ id, icon, label }) => (
        <div
          key={id}
          style={navItemStyle(activeTab === id)}
          onClick={() => setTab(id)}
          onMouseEnter={(e) => {
            if (activeTab !== id) {
              Object.assign(e.currentTarget.style, navItemHoverStyle);
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== id) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#94a3b8';
            }
          }}
          title={label}
        >
          {icon}
        </div>
      ))}
    </nav>
  );
}
