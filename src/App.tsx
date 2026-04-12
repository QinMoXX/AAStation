import { useEffect } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/canvas/FlowCanvas';
import CanvasToolbar from './components/canvas/CanvasToolbar';
import NodePanel from './components/nodes/NodePanel';
import AppLayout from './components/layout/AppLayout';
import { useDagSync } from './hooks/useDagSync';
import { useSettingsStore } from './store/settings-store';

function AppInner() {
  useDagSync();

  // Load settings on mount
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <AppLayout>
      <FlowCanvas />
      <CanvasToolbar />
      <NodePanel />
    </AppLayout>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}

export default App;
