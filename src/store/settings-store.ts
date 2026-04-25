import { create } from 'zustand';
import type { AppSettings } from '../types/settings';
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '../lib/tauri-api';

// ---------------------------------------------------------------------------
// Settings state
// ---------------------------------------------------------------------------

interface SettingsState {
  /** Current application settings. */
  settings: AppSettings;

  /** Whether settings have been loaded from the backend. */
  loaded: boolean;

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /** Load settings from the backend (call once on app mount). */
  loadSettings: () => Promise<void>;

  /** Update and persist settings. */
  saveSettings: (settings: AppSettings) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  listenPortRange: '9527-9537',
  listenAddress: '127.0.0.1',
  proxyAuthToken: '',
  logDirMaxMb: 500,
  launchAtStartup: false,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await loadSettingsApi();
      set({ settings, loaded: true });
    } catch {
      // Use defaults if load fails
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },

  saveSettings: async (settings) => {
    await saveSettingsApi(settings);
    set({ settings });
  },
}));
