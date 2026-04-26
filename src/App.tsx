import { useEffect, useRef } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/canvas/FlowCanvas';
import CanvasToolbar from './components/canvas/CanvasToolbar';
import NodePanel from './components/nodes/NodePanel';
import AppLayout from './components/layout/AppLayout';
import { useDagSync } from './hooks/useDagSync';
import { checkAndMaybeInstallUpdate } from './lib/tauri-api';
import { useSettingsStore } from './store/settings-store';
import { toast } from './store/toast-store';

function AppInner() {
  useDagSync();

  // Load settings on mount
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loaded = useSettingsStore((s) => s.loaded);
  const settings = useSettingsStore((s) => s.settings);
  const checkedUpdateRef = useRef(false);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!loaded || checkedUpdateRef.current || !settings.autoCheckUpdate) return;
    checkedUpdateRef.current = true;

    void (async () => {
      try {
        const result = await checkAndMaybeInstallUpdate(settings.autoInstallUpdate);
        if (!result.hasUpdate) return;
        if (!result.installed) {
          toast.info(`检测到新版本 ${result.latestVersion}，可在设置页手动触发安装。`);
        }
      } catch {
        // Ignore startup update errors to avoid interrupting normal app usage.
      }
    })();
  }, [loaded, settings.autoCheckUpdate, settings.autoInstallUpdate]);

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
