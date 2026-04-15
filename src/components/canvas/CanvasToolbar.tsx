import { useCallback } from 'react';
import { useReactFlow } from 'reactflow';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'center',
};

const btnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  fontSize: 16,
  fontWeight: 500,
  border: '1px solid #374151',
  borderRadius: 6,
  background: '#2b2b2b',
  color: '#d1d5db',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
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
