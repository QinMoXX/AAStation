import type { NodeTag } from './tag';

/** Preset Provider configuration - loaded from JSON file. */
export interface ProviderPreset {
  /** Unique identifier for this preset. */
  id: string;
  /** Display name shown in dropdown. */
  name: string;
  /** Icon identifier - maps to SVG component in ProviderIcons.tsx. */
  icon: string;
  /** Creation mode:
   *  - preset: create a preset provider with fixed URLs
   *  - custom: create an empty custom provider node */
  createMode?: 'preset' | 'custom';
  /** OpenAI-compatible base URL (immutable for presets).
   *  Should include version path prefix (e.g. "https://api.openai.com/v1"). */
  baseUrl: string;
  /** Anthropic-compatible base URL (optional, immutable for presets).
   *  Should NOT include version path prefix (e.g. "https://open.bigmodel.cn/api/anthropic"). */
  anthropicBaseUrl?: string;
  /** Default label for new nodes (user can modify). */
  defaultLabel: string;
  /** Capability tags for compatibility filtering. */
  tag: NodeTag[];
  /** Available models for quick selection. */
  models: PresetModel[];
}

/** A model option within a preset. */
export interface PresetModel {
  /** Model identifier. */
  name: string;
  /** Friendly display name. */
  label?: string;
}
