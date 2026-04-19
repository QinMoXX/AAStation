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
            version: 2,
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
    /// - `Provider`  → `ProviderNodeData`
    /// - `Switcher`   → `SwitcherNodeData`
    /// - `Application`  → `ApplicationNodeData`
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
    /// Source handle (e.g. "model-{uuid}", "unified", "output").
    #[serde(default)]
    pub source_handle: Option<String>,
    /// Target handle (e.g. "entry-{uuid}", "default", "input").
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
    Provider,
    Switcher,
    Application,
}

impl std::fmt::Display for NodeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeType::Provider => write!(f, "provider"),
            NodeType::Switcher => write!(f, "switcher"),
            NodeType::Application => write!(f, "application"),
        }
    }
}

// --- Node-specific data structures (typed wrappers for `DAGNode.data`) ---

/// A model entry within a Provider node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModel {
    /// UUID, also used as handle ID: "model-{id}"
    pub id: String,
    /// Model name, e.g. "gpt-4o"
    pub name: String,
    /// Whether this model entry is active.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Provider node data: an upstream API endpoint with model sub-nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// OpenAI-compatible base URL. Should include version path prefix
    /// (e.g. "https://api.openai.com/v1").
    pub base_url: String,
    /// Anthropic-compatible base URL (optional). Should NOT include version path prefix
    /// (e.g. "https://open.bigmodel.cn/api/anthropic").
    /// When set, Anthropic-style client requests will be forwarded to this URL
    /// instead of base_url, avoiding the need for response format conversion.
    #[serde(default)]
    pub anthropic_base_url: Option<String>,
    /// API key for authentication.
    pub api_key: String,
    /// Model entries, each with its own right-side output handle.
    pub models: Vec<ProviderModel>,
}

impl Default for ProviderNodeData {
    fn default() -> Self {
        Self {
            label: "Provider".to_string(),
            description: None,
            base_url: String::new(),
            anthropic_base_url: None,
            api_key: String::new(),
            models: Vec::new(),
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

/// A matcher entry within a Switcher node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitcherEntry {
    /// UUID, also used as handle ID: "entry-{id}"
    pub id: String,
    /// Display label, e.g. "claude-sonnet-4"
    pub label: String,
    /// Match type for this entry.
    pub match_type: MatchType,
    /// Match pattern (model name, path prefix, or header value).
    pub pattern: String,
}

/// Switcher node data: routes requests by matchers to different Providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitcherNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Matcher entries, each with a right-side output handle.
    pub entries: Vec<SwitcherEntry>,
    /// Whether a "default" output handle exists for unmatched requests.
    #[serde(default)]
    pub has_default: bool,
}

impl Default for SwitcherNodeData {
    fn default() -> Self {
        Self {
            label: "Switcher".to_string(),
            description: None,
            entries: Vec::new(),
            has_default: false,
        }
    }
}

/// Application node data: represents an end application/tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationNodeData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Application type for display purposes.
    #[serde(default = "default_app_type")]
    pub app_type: String,
    /// The port this application listens on. Each Application node gets its own
    /// port from the settings port range. 0 means unassigned (will be auto-assigned).
    #[serde(default)]
    pub listen_port: u16,
    /// Handler code executed on publish. Reserved for future use — currently empty.
    #[serde(default)]
    pub application_handler: String,
    /// Handler code executed on unpublish (stop or app close). Reserved for future use — currently empty.
    #[serde(default)]
    pub unpublish_handler: String,
}

fn default_app_type() -> String {
    "listener".to_string()
}

impl Default for ApplicationNodeData {
    fn default() -> Self {
        Self {
            label: "Listener".to_string(),
            description: None,
            app_type: default_app_type(),
            listen_port: 0,
            application_handler: String::new(),
            unpublish_handler: String::new(),
        }
    }
}
