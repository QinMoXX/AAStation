import type { DAGDocument } from '../types/dag';

const APP_CONFIG_GUIDE_DISMISSED_KEY = 'aastation.app-config-guide-dismissed';

export function hasApplicationNodes(doc: DAGDocument): boolean {
  return doc.nodes.some((node) => node.data.nodeType === 'application');
}

export function shouldShowAppConfigGuide(): boolean {
  try {
    return window.localStorage.getItem(APP_CONFIG_GUIDE_DISMISSED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissAppConfigGuide(): void {
  try {
    window.localStorage.setItem(APP_CONFIG_GUIDE_DISMISSED_KEY, '1');
  } catch {
    // Ignore storage failures and allow the dialog to show again next time.
  }
}
