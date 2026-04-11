#![allow(dead_code, unused_imports)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Complete DAG document — the persistence unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DAGDocument {
    /// Document schema version for future migrations.
    pub version: u32,
    /// Unique document identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// React Flow node list.
    pub nodes: Vec<DAGNode>,
    /// React Flow edge list.
    pub edges: Vec<DAGEdge>,
    /// Viewport state (zoom / pan).
    #[serde(default)]
    pub viewport: Option<Viewport>,
    /// Last modification time (ISO 8601).
    pub updated_at: String,
}

impl Default for DAGDocument {
    fn default() -> Self {
        Self {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            name: "Untitled Pipeline".to_string(),
            nodes: Vec::new(),
            edges: Vec::new(),
            viewport: None,
            updated_at: String::new(),
        }
    }
}

/// Canvas viewport state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// A single node in the DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DAGNode {
    pub id: String,
    pub node_type: NodeType,
    pub position: Position,
    /// Node-type-specific data stored as a JSON value.
    /// Discriminated by `node_type`:
    /// - `Listener` → `ListenerNodeData`
    /// - `Router`   → `RouterNodeData`
    /// - `Forward`  → `ForwardNodeData`
    pub data: serde_json::Value,
}

/// Node position on the canvas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// A directed edge connecting two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DAGEdge {
    pub id: String,
    /// Source node ID.
    pub source: String,
    /// Target node ID.
    pub target: String,
    /// Source handle (for multi-output nodes like Router).
    #[serde(default)]
    pub source_handle: Option<String>,
    /// Target handle.
    #[serde(default)]
    pub target_handle: Option<String>,
    /// Edge-type-specific data.
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// Node type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Listener,
    Router,
    Forward,
}

impl std::fmt::Display for NodeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeType::Listener => write!(f, "listener"),
            NodeType::Router => write!(f, "router"),
            NodeType::Forward => write!(f, "forward"),
        }
    }
}

// --- Node-specific data structures (typed wrappers for `DAGNode.data`) ---

/// Listener node data: defines the local port the proxy listens on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenerNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub port: u16,
    pub bind_address: String,
}

impl Default for ListenerNodeData {
    fn default() -> Self {
        Self {
            label: "Listener".to_string(),
            description: None,
            port: 9527,
            bind_address: "127.0.0.1".to_string(),
        }
    }
}

/// A single routing rule inside a Router node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub id: String,
    pub match_type: MatchType,
    /// - `path_prefix`: e.g. "/v1/messages"
    /// - `header`: "Header-Name:value" format
    /// - `model`: model name e.g. "claude-sonnet-4-20250514"
    pub pattern: String,
    /// The outgoing edge ID this rule corresponds to.
    pub target_edge_id: String,
}

/// Router node data: routes requests by rules to different Forward nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub rules: Vec<RoutingRule>,
    /// Edge ID used when no rule matches (default route).
    #[serde(default)]
    pub default_edge_id: Option<String>,
}

impl Default for RouterNodeData {
    fn default() -> Self {
        Self {
            label: "Router".to_string(),
            description: None,
            rules: Vec::new(),
            default_edge_id: None,
        }
    }
}

/// Forward node data: an upstream API endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub upstream_url: String,
    pub api_key: String,
    /// Extra headers to add/overwrite on forwarded requests.
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
}

impl Default for ForwardNodeData {
    fn default() -> Self {
        Self {
            label: "Forward".to_string(),
            description: None,
            upstream_url: String::new(),
            api_key: String::new(),
            extra_headers: HashMap::new(),
        }
    }
}

/// Route match strategy (shared between DAG routing rules and compiled routes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    PathPrefix,
    Header,
    Model,
}

impl std::fmt::Display for MatchType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MatchType::PathPrefix => write!(f, "path_prefix"),
            MatchType::Header => write!(f, "header"),
            MatchType::Model => write!(f, "model"),
        }
    }
}
