#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// API compatibility type for compiled routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiType {
    Anthropic,
    OpenAI,
}

/// The protocol style of an incoming client request, detected from the request path.
/// This determines how the request body is interpreted before protocol adaptation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestProtocol {
    /// OpenAI-style: POST /v1/chat/completions, body has "messages"
    OpenAI,
    /// Anthropic-style: POST /v1/messages, body has "messages" + "max_tokens"
    Anthropic,
}

/// Compiled routing table — output of DAG compilation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RouteTable {
    pub listen_port: u16,
    pub listen_address: String,
    pub routes: Vec<CompiledRoute>,
    pub default_route: Option<CompiledRoute>,
}

impl RouteTable {
    pub fn is_empty(&self) -> bool {
        self.routes.is_empty() && self.default_route.is_none()
    }
}

/// A single compiled route entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledRoute {
    pub id: String,
    pub match_type: MatchType,
    pub pattern: String,
    pub upstream_url: String,
    /// Anthropic-compatible upstream URL (optional). When set, Anthropic-style client
    /// requests will be forwarded to this URL instead of upstream_url.
    #[serde(default)]
    pub anthropic_upstream_url: Option<String>,
    pub api_key: String,
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
    pub is_default: bool,
    /// API compatibility type for request/response adaptation.
    #[serde(default)]
    pub api_type: Option<ApiType>,
    /// Target model name to replace in the request body when forwarding.
    /// If empty, the original model is kept.
    #[serde(default)]
    pub target_model: String,
    /// Whether to use substring matching for model patterns.
    /// When true, pattern matches if it is a substring of the request model.
    /// This is used for Claude Code connections where model names like
    /// "claude-haiku-4-5-20251001" should match pattern "claude-haiku".
    #[serde(default)]
    pub fuzzy_match: bool,
}

/// Route match strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    PathPrefix,
    Header,
    Model,
}

/// Proxy server configuration (derived from settings at publish time).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub listen_port: u16,
    pub listen_address: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
        }
    }
}

/// Runtime status of the proxy server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub published_at: Option<String>,
    pub active_routes: usize,
    pub total_requests: u64,
    pub uptime_seconds: u64,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 0,
            published_at: None,
            active_routes: 0,
            total_requests: 0,
            uptime_seconds: 0,
        }
    }
}
