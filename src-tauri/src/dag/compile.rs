#![allow(dead_code, unused_imports)]

use std::collections::HashMap;

use crate::proxy::types::{ApiType, CompiledRoute, MatchType, RouteTable};
use crate::settings::AppSettings;

use super::types::{
    DAGDocument, DAGEdge, DAGNode, NodeType, ProviderNodeData, RouterNodeData,
};

/// Compile a DAG document into a flat route table.
///
/// Traversal logic (left-to-right flow: Provider → Router → Terminal):
/// 1. Get listen_port / listen_address from settings (not from a Listener node)
/// 2. Build handle → edge lookup maps for efficient traversal
/// 3. For each Router node:
///    - For each entry: find the edge targeting this entry's handle → trace to Provider
///    - For the "default" handle: find the edge → trace to Provider
/// 4. For Terminal nodes directly connected to a Provider (no Router):
///    - Build a default/catch-all route
pub fn compile(doc: &DAGDocument, settings: &AppSettings) -> Result<RouteTable, CompileError> {
    // Build node lookup map
    let node_map: HashMap<&str, &DAGNode> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Build target lookup: (target_node_id, target_handle) → &DAGEdge
    let target_edge_map: HashMap<(&str, &str), &DAGEdge> = doc
        .edges
        .iter()
        .filter_map(|e| {
            match (&e.target_handle, e.target_handle.as_deref()) {
                (Some(h), _) => Some(((e.target.as_str(), h.as_str()), e)),
                _ => None,
            }
        })
        .collect();

    // Build source lookup: (source_node_id, source_handle) → &DAGEdge
    let _source_edge_map: HashMap<(&str, &str), &DAGEdge> = doc
        .edges
        .iter()
        .filter_map(|e| {
            match (&e.source_handle, e.source_handle.as_deref()) {
                (Some(h), _) => Some(((e.source.as_str(), h.as_str()), e)),
                _ => None,
            }
        })
        .collect();

    let mut routes: Vec<CompiledRoute> = Vec::new();
    let mut default_route: Option<CompiledRoute> = None;

    // Process all Router nodes
    for node in &doc.nodes {
        if node.node_type != NodeType::Router {
            continue;
        }

        let router_data: RouterNodeData = deserialize_node_data(node)?;

        // Process each routing entry
        for entry in &router_data.entries {
            // Find the edge connecting to this entry's target handle
            let entry_handle = format!("entry-{}", entry.id);
            let edge = target_edge_map
                .get(&(node.id.as_str(), entry_handle.as_str()))
                .ok_or_else(|| CompileError::EntryEdgeNotFound(entry.id.clone()))?;

            // Trace to the source Provider
            let provider = resolve_provider(&edge.source, &node_map)?;
            let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

            routes.push(CompiledRoute {
                id: format!("route-{}", entry.id),
                match_type: match entry.match_type {
                    super::types::MatchType::PathPrefix => MatchType::PathPrefix,
                    super::types::MatchType::Header => MatchType::Header,
                    super::types::MatchType::Model => MatchType::Model,
                },
                pattern: entry.pattern.clone(),
                upstream_url: provider_data.base_url,
                api_key: provider_data.api_key,
                extra_headers: HashMap::new(),
                is_default: false,
                api_type: Some(match provider_data.api_type {
                    super::types::ApiType::Anthropic => ApiType::Anthropic,
                    super::types::ApiType::OpenAI => ApiType::OpenAI,
                }),
            });
        }

        // Process default route for this Router
        if router_data.has_default {
            let default_handle = "default";
            let edge = target_edge_map
                .get(&(node.id.as_str(), default_handle))
                .ok_or_else(|| CompileError::DefaultEdgeNotFound(node.id.clone()))?;

            let provider = resolve_provider(&edge.source, &node_map)?;
            let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

            default_route = Some(CompiledRoute {
                id: format!("route-default-{}", node.id),
                match_type: MatchType::PathPrefix,
                pattern: String::new(),
                upstream_url: provider_data.base_url,
                api_key: provider_data.api_key,
                extra_headers: HashMap::new(),
                is_default: true,
                api_type: Some(match provider_data.api_type {
                    super::types::ApiType::Anthropic => ApiType::Anthropic,
                    super::types::ApiType::OpenAI => ApiType::OpenAI,
                }),
            });
        }
    }

    // Process Terminal nodes directly connected to a Provider (no Router)
    for node in &doc.nodes {
        if node.node_type != NodeType::Terminal {
            continue;
        }

        // Find edges where this Terminal is the target
        for edge in &doc.edges {
            if edge.target != node.id {
                continue;
            }

            let source_node = node_map.get(edge.source.as_str());
            if let Some(source) = source_node {
                if source.node_type == NodeType::Provider {
                    let provider_data: ProviderNodeData = deserialize_node_data(source)?;
                    // Only set default route if not already set by a Router
                    if default_route.is_none() {
                        default_route = Some(CompiledRoute {
                            id: format!("route-direct-{}", node.id),
                            match_type: MatchType::PathPrefix,
                            pattern: String::new(),
                            upstream_url: provider_data.base_url,
                            api_key: provider_data.api_key,
                            extra_headers: HashMap::new(),
                            is_default: true,
                            api_type: Some(match provider_data.api_type {
                                super::types::ApiType::Anthropic => ApiType::Anthropic,
                                super::types::ApiType::OpenAI => ApiType::OpenAI,
                            }),
                        });
                    }
                }
            }
        }
    }

    Ok(RouteTable {
        listen_port: settings.listen_port,
        listen_address: settings.listen_address.clone(),
        routes,
        default_route,
    })
}

/// Resolve a node ID to a Provider node, or return an error.
fn resolve_provider<'a>(
    node_id: &str,
    node_map: &HashMap<&str, &'a DAGNode>,
) -> Result<&'a DAGNode, CompileError> {
    let node = node_map
        .get(node_id)
        .ok_or_else(|| CompileError::EdgeToMissingNode(node_id.to_string()))?;

    if node.node_type != NodeType::Provider {
        return Err(CompileError::SourceNotProvider(node_id.to_string()));
    }

    Ok(*node)
}

/// Deserialize a DAG node's `data` field into a typed struct.
fn deserialize_node_data<T: serde::de::DeserializeOwned>(
    node: &DAGNode,
) -> Result<T, CompileError> {
    serde_json::from_value::<T>(node.data.clone())
        .map_err(|e| CompileError::NodeDataDeserializeFailed(node.id.clone(), e.to_string()))
}

/// Errors that can occur during DAG compilation.
#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    #[error("routing entry '{0}' has no connected edge")]
    EntryEdgeNotFound(String),
    #[error("default edge for router '{0}' not found")]
    DefaultEdgeNotFound(String),
    #[error("edge points to missing node '{0}'")]
    EdgeToMissingNode(String),
    #[error("source node '{0}' is not a Provider node")]
    SourceNotProvider(String),
    #[error("failed to deserialize data for node '{0}': {1}")]
    NodeDataDeserializeFailed(String, String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::types::{
        DAGEdge, DAGDocument, DAGNode, MatchType as DagMatchType, NodeType, Position,
        ProviderModel, ProviderNodeData, RouterEntry, RouterNodeData, TerminalNodeData,
        ApiType as DagApiType,
    };
    use crate::proxy::types::MatchType as ProxyMatchType;
    use std::collections::HashMap;

    fn default_settings() -> AppSettings {
        AppSettings {
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
        }
    }

    fn make_provider(id: &str, label: &str, api_type: DagApiType, base_url: &str, api_key: &str, models: Vec<ProviderModel>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Provider,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ProviderNodeData {
                label: label.to_string(),
                description: None,
                api_type,
                base_url: base_url.to_string(),
                api_key: api_key.to_string(),
                models,
            })
            .unwrap(),
        }
    }

    fn make_router(id: &str, entries: Vec<RouterEntry>, has_default: bool) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Router,
            position: Position { x: 200.0, y: 0.0 },
            data: serde_json::to_value(RouterNodeData {
                label: "Router".to_string(),
                description: None,
                entries,
                has_default,
            })
            .unwrap(),
        }
    }

    fn make_terminal(id: &str, label: &str, app_type: &str) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Terminal,
            position: Position { x: 400.0, y: 0.0 },
            data: serde_json::to_value(TerminalNodeData {
                label: label.to_string(),
                description: None,
                app_type: app_type.to_string(),
            })
            .unwrap(),
        }
    }

    fn make_edge(id: &str, source: &str, target: &str, source_handle: Option<&str>, target_handle: Option<&str>) -> DAGEdge {
        DAGEdge {
            id: id.to_string(),
            source: source.to_string(),
            target: target.to_string(),
            source_handle: source_handle.map(|s| s.to_string()),
            target_handle: target_handle.map(|s| s.to_string()),
            data: None,
        }
    }

    #[test]
    fn test_provider_to_router_to_terminal() {
        let model_id = "model-1";
        let entry_id = "entry-1";

        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-test",
            vec![ProviderModel { id: model_id.to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let router = make_router(
            "r1",
            vec![RouterEntry {
                id: entry_id.to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            false,
        );

        let terminal = make_terminal("t1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "p1", "r1", Some(&format!("model-{}", model_id)), Some(&format!("entry-{}", entry_id))),
            make_edge("e2", "r1", "t1", Some("output"), Some("input")),
        ];

        let doc = DAGDocument {
            nodes: vec![provider, router, terminal],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.listen_port, 9527);
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[0].pattern, "gpt-4o");
        assert_eq!(table.routes[0].upstream_url, "https://api.openai.com");
        assert_eq!(table.routes[0].api_type, Some(ApiType::OpenAI));
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_provider_to_router_with_default() {
        let entry_id = "entry-1";

        let provider_a = make_provider(
            "pa", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let provider_b = make_provider(
            "pb", "Anthropic", DagApiType::Anthropic,
            "https://api.anthropic.com", "sk-ant-key",
            vec![],
        );

        let router = make_router(
            "r1",
            vec![RouterEntry {
                id: entry_id.to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            true,
        );

        let terminal = make_terminal("t1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "pa", "r1", Some("model-m1"), Some(&format!("entry-{}", entry_id))),
            make_edge("e2", "pb", "r1", Some("unified"), Some("default")),
            make_edge("e3", "r1", "t1", Some("output"), Some("input")),
        ];

        let doc = DAGDocument {
            nodes: vec![provider_a, provider_b, router, terminal],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://api.anthropic.com");
        assert_eq!(table.default_route.as_ref().unwrap().api_type, Some(ApiType::Anthropic));
    }

    #[test]
    fn test_provider_direct_to_terminal() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-test",
            vec![],
        );

        let terminal = make_terminal("t1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "p1", "t1", Some("unified"), Some("input")),
        ];

        let doc = DAGDocument {
            nodes: vec![provider, terminal],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.unwrap().upstream_url, "https://api.openai.com");
    }

    #[test]
    fn test_entry_edge_not_found() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-test",
            vec![],
        );

        let router = make_router(
            "r1",
            vec![RouterEntry {
                id: "entry-1".to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            false,
        );

        // No edge connecting provider to router entry
        let doc = DAGDocument {
            nodes: vec![provider, router],
            edges: vec![],
            ..Default::default()
        };

        assert!(matches!(compile(&doc, &default_settings()), Err(CompileError::EntryEdgeNotFound(_))));
    }

    #[test]
    fn test_default_edge_not_found() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-test",
            vec![],
        );

        let router = make_router("r1", vec![], true);

        let doc = DAGDocument {
            nodes: vec![provider, router],
            edges: vec![],
            ..Default::default()
        };

        assert!(matches!(compile(&doc, &default_settings()), Err(CompileError::DefaultEdgeNotFound(_))));
    }

    #[test]
    fn test_multiple_providers_different_api_types() {
        let openai = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let anthropic = make_provider(
            "p2", "Anthropic", DagApiType::Anthropic,
            "https://api.anthropic.com", "sk-ant-key",
            vec![ProviderModel { id: "m2".to_string(), name: "claude-sonnet-4".to_string(), enabled: true }],
        );

        let router = make_router(
            "r1",
            vec![
                RouterEntry {
                    id: "entry-1".to_string(),
                    label: "gpt-4o".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "gpt-4o".to_string(),
                },
                RouterEntry {
                    id: "entry-2".to_string(),
                    label: "claude-sonnet-4".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "claude-sonnet-4-20250514".to_string(),
                },
            ],
            false,
        );

        let terminal = make_terminal("t1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "p1", "r1", Some("model-m1"), Some("entry-entry-1")),
            make_edge("e2", "p2", "r1", Some("model-m2"), Some("entry-entry-2")),
            make_edge("e3", "r1", "t1", Some("output"), Some("input")),
        ];

        let doc = DAGDocument {
            nodes: vec![openai, anthropic, router, terminal],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.routes.len(), 2);
        assert_eq!(table.routes[0].api_type, Some(ApiType::OpenAI));
        assert_eq!(table.routes[1].api_type, Some(ApiType::Anthropic));
    }

    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.listen_port, 9527);
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_none());
    }
}
