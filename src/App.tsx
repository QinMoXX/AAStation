import { useEffect, useRef } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/canvas/FlowCanvas';
import CanvasToolbar from './components/canvas/CanvasToolbar';
import NodePanel from './components/nodes/NodePanel';
import AppLayout from './components/layout/AppLayout';
import { useDagSync } from './hooks/useDagSync';
import { checkForAppUpdate } from './lib/tauri-api';
import { useAppStore } from './store/app-store';
import { useSettingsStore } from './store/settings-store';
import { toast } from './store/toast-store';

function DagSyncBridge() {
  useDagSync();
  return null;
}

function AppInner() {
  // Load settings on mount
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loaded = useSettingsStore((s) => s.loaded);
  const settings = useSettingsStore((s) => s.settings);
  const setAvailableUpdate = useAppStore((s) => s.setAvailableUpdate);
  const clearAvailableUpdate = useAppStore((s) => s.clearAvailableUpdate);
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
        const result = await checkForAppUpdate();
        if (!result.hasUpdate || !result.latestVersion) {
          clearAvailableUpdate();
          return;
        }
        setAvailableUpdate({
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          notes: result.notes,
        });
        toast.info(`检测到新版本 ${result.latestVersion}，可进入设置界面点击“立即更新”安装。`, 7000);
      } catch {
        // Ignore startup update errors to avoid interrupting normal app usage.
      }
    })();
  }, [clearAvailableUpdate, loaded, setAvailableUpdate, settings.autoCheckUpdate]);

  return (
    <>
      <DagSyncBridge />
      <AppLayout>
        <FlowCanvas />
        <CanvasToolbar />
        <NodePanel />
      </AppLayout>
    </>
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
