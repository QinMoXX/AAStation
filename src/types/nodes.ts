/** Node type discriminator. */
export type NodeType = 'provider' | 'router' | 'terminal';

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
  baseUrl: string; // e.g. "https://api.anthropic.com"
  apiKey: string;
  /** Model entries, each with its own right-side output handle. */
  models: ProviderModel[];
}

/** A routing entry within a Router node. */
export interface RouterEntry {
  id: string; // uuid, also used as handle ID: "entry-{id}"
  label: string; // e.g. "claude-sonnet-4"
  matchType: 'path_prefix' | 'header' | 'model';
  /** - path_prefix: path prefix e.g. "/v1/messages"
   *  - header: "Header-Name:value" format
   *  - model: model name e.g. "claude-sonnet-4-20250514" */
  pattern: string;
  /** Target model name to replace in the request body when forwarding.
   *  If empty, the original model is kept. */
  targetModel: string;
}

/** Router node: routes requests by model matching to different Providers. */
export interface RouterNodeData extends BaseNodeData {
  nodeType: 'router';
  /** Routing entries, each with a left-side input handle. */
  entries: RouterEntry[];
  /** Whether a "default" input handle exists for unmatched requests. */
  hasDefault: boolean;
}

/** Terminal node: represents an end application/tool that uses the proxy. */
export interface TerminalNodeData extends BaseNodeData {
  nodeType: 'terminal';
  /** Application type for display purposes. */
  appType: string; // 'claude_code' | 'openclaw' | 'custom'
}

/** Union of all node data types. */
export type AAStationNodeData =
  | ProviderNodeData
  | RouterNodeData
  | TerminalNodeData;
