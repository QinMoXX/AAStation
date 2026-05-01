import { create } from 'zustand';

/** 一级导航项 */
export type NavTab = 'home' | 'monitor' | 'plugins' | 'settings';

/** 二级导航项（仅主页使用） */
export type HomeSubTab = 'provider' | 'middleware' | 'application';

interface NavState {
  /** 当前一级导航 */
  activeTab: NavTab;
  /** 当前二级导航（仅主页有效） */
  homeSubTab: HomeSubTab;
  /** 切换一级导航 */
  setTab: (tab: NavTab) => void;
  /** 切换二级导航 */
  setHomeSubTab: (subTab: HomeSubTab) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeTab: 'home',
  homeSubTab: 'provider',
  setTab: (tab) => set({ activeTab: tab }),
  setHomeSubTab: (subTab) => set({ homeSubTab: subTab }),
}));
