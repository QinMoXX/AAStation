/** Node type discriminator. */
export type NodeType = 'listener' | 'router' | 'forward';

interface BaseNodeData {
  label: string;
  description?: string;
}

/** Listener node: defines the local port the proxy listens on. */
export interface ListenerNodeData extends BaseNodeData {
  nodeType: 'listener';
  port: number; // default 9527
  bindAddress: string; // default "127.0.0.1"
}

/** A single routing rule inside a Router node. */
export interface RoutingRule {
  id: string; // uuid
  matchType: 'path_prefix' | 'header' | 'model';
  /** - path_prefix: path prefix e.g. "/v1/messages"
   *  - header: "Header-Name:value" format
   *  - model: model name e.g. "claude-sonnet-4-20250514" */
  pattern: string;
  /** The outgoing edge ID this rule corresponds to. */
  targetEdgeId: string;
}

/** Router node: routes requests by rules to different Forward nodes. */
export interface RouterNodeData extends BaseNodeData {
  nodeType: 'router';
  rules: RoutingRule[];
  /** Edge ID used when no rule matches (default route). */
  defaultEdgeId: string | null;
}

/** Forward node: an upstream API endpoint. */
export interface ForwardNodeData extends BaseNodeData {
  nodeType: 'forward';
  upstreamUrl: string; // e.g. "https://api.anthropic.com"
  apiKey: string;
  /** Extra headers to add/overwrite on forwarded requests. */
  extraHeaders?: Record<string, string>;
}

/** Union of all node data types. */
export type AAStationNodeData =
  | ListenerNodeData
  | RouterNodeData
  | ForwardNodeData;
