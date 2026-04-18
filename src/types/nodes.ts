/** Node type discriminator. */
export type NodeType = 'provider' | 'switcher' | 'application';

/** Handle type discriminator for connection validation. */
export type HandleType = 'model' | 'any';

/** API compatibility type for Provider nodes. */
export type ApiType = 'anthropic' | 'openai';

interface BaseNodeData {
  label: string;
  description?: string;
}

/** A model entry within a Provider node. */
export interface ProviderModel {
  id: string; // uuid, also used as handle ID: "model-{id}"
  name: string; // e.g. "gpt-4o"
  enabled: boolean;
}

/** Provider node: an upstream API endpoint with model sub-nodes. */
export interface ProviderNodeData extends BaseNodeData {
  nodeType: 'provider';
  /** Preset ID if created from a preset (apiType/baseUrl become read-only). */
  presetId?: string;
  apiType: ApiType;
  baseUrl: string; // e.g. "https://api.openai.com/v1"
  /** Anthropic-compatible base URL (optional). When set, Anthropic-style client
   *  requests will be forwarded to this URL instead of baseUrl, avoiding the
   *  need for response format conversion. */
  anthropicBaseUrl?: string; // e.g. "https://open.bigmodel.cn/api/anthropic"
  apiKey: string;
  /** Model entries, each with its own right-side output handle. */
  models: ProviderModel[];
}

/** A matcher entry within a Switcher node. */
export interface SwitcherEntry {
  id: string; // uuid, also used as handle ID: "entry-{id}"
  label: string; // e.g. "claude-sonnet-4"
  matchType: 'path_prefix' | 'header' | 'model';
  /** - path_prefix: path prefix e.g. "/v1/messages"
   *  - header: "Header-Name:value" format
   *  - model: model name e.g. "claude-sonnet-4-20250514" */
  pattern: string;
}

/** Switcher node: routes requests by matchers to different Providers. */
export interface SwitcherNodeData extends BaseNodeData {
  nodeType: 'switcher';
  /** Matcher entries, each with a right-side output handle. */
  entries: SwitcherEntry[];
  /** Whether a "default" output handle exists for unmatched requests. */
  hasDefault: boolean;
}

/** Application type discriminator. */
export type AppType = 'listener' | 'claude_code';

/** Application node: represents an end application/tool that uses the proxy. */
export interface ApplicationNodeData extends BaseNodeData {
  nodeType: 'application';
  /** Application type for display purposes. */
  appType: AppType;
}

/** Union of all node data types. */
export type AAStationNodeData =
  | ProviderNodeData
  | SwitcherNodeData
  | ApplicationNodeData;
