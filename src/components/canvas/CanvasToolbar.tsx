import { useCallback } from 'react';
import { useReactFlow } from 'reactflow';

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <div className="ui-canvas-toolbar">
      <button type="button" className="ui-canvas-toolbar-btn" onClick={() => zoomIn()} title="放大">
        +
      </button>
      <button type="button" className="ui-canvas-toolbar-btn" onClick={() => zoomOut()} title="缩小">
        −
      </button>
      <button type="button" className="ui-canvas-toolbar-btn" onClick={handleFitView} title="适配画布">
        ⊞
      </button>
    </div>
  );
}
