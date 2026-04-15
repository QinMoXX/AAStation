import { useCallback } from 'react';
import { useReactFlow } from 'reactflow';

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
  border: '1px solid #374151',
  borderRadius: 6,
  background: '#2b2b2b',
  color: '#d1d5db',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  whiteSpace: 'nowrap' as const,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#374151',
  margin: '0 4px',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <div style={toolbarStyle}>
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
