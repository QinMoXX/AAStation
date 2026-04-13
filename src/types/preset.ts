import type { ApiType } from './nodes';

/** Preset Provider configuration - loaded from JSON file. */
export interface ProviderPreset {
  /** Unique identifier for this preset. */
  id: string;
  /** Display name shown in dropdown. */
  name: string;
  /** Icon identifier - maps to SVG component in ProviderIcons.tsx. */
  icon: string;
  /** API compatibility type (immutable for presets). */
  apiType: ApiType;
  /** Base URL for API requests (immutable for presets). */
  baseUrl: string;
  /** Default label for new nodes (user can modify). */
  defaultLabel: string;
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
