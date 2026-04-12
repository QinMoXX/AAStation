import { useCallback } from 'react';
import { useReactFlow } from 'reactflow';
import { useFlowStore } from '../../store/flow-store';
import type { NodeType } from '../../types';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 10,
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  whiteSpace: 'nowrap' as const,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#e2e8f0',
  margin: '0 4px',
};

// ---------------------------------------------------------------------------
// Add-node button data
// ---------------------------------------------------------------------------

const NODE_ADD_OPTIONS: { type: NodeType; label: string; icon: string; color: string }[] = [
  { type: 'provider', label: 'Provider', icon: '☁️', color: '#3b82f6' },
  { type: 'router', label: 'Router', icon: '🔀', color: '#f59e0b' },
  { type: 'terminal', label: 'Terminal', icon: '🖥️', color: '#16a34a' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CanvasToolbar() {
  const addNode = useFlowStore((s) => s.addNode);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleAddNode = useCallback(
    (type: NodeType) => {
      addNode(type);
    },
    [addNode],
  );

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <div style={toolbarStyle}>
      {/* Add node buttons */}
      {NODE_ADD_OPTIONS.map(({ type, label, icon, color }) => (
        <button
          key={type}
          style={{ ...btnStyle, borderColor: color, color }}
          onClick={() => handleAddNode(type)}
        >
          {icon} {label}
        </button>
      ))}

      <div style={separatorStyle} />

      {/* Zoom controls */}
      <button style={btnStyle} onClick={() => zoomIn()} title="Zoom In">
        +
      </button>
      <button style={btnStyle} onClick={() => zoomOut()} title="Zoom Out">
        −
      </button>
      <button style={btnStyle} onClick={handleFitView} title="Fit View">
        ⊞
      </button>
    </div>
  );
}
