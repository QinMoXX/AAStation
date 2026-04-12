#![allow(dead_code, unused_imports)]

use serde::{Deserialize, Serialize};
use crate::dag::types::*;

/// A single validation error with context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationError {
    pub kind: ValidationErrorKind,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ValidationError {}

/// Kinds of validation errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ValidationErrorKind {
    /// A node has no connected edges (orphan).
    OrphanNode,
    /// A provider node is missing its base_url.
    ProviderNoBaseUrl,
    /// A provider node is missing its api_key.
    ProviderNoApiKey,
    /// A router node has no routing entries.
    RouterNoEntries,
    /// A terminal node has no incoming edges.
    TerminalDisconnected,
    /// Invalid edge: source or target node does not exist.
    EdgeToMissingNode,
    /// Invalid edge: connection type not allowed.
    InvalidEdgeType,
    /// Failed to deserialize node data.
    NodeDataInvalid,
}

impl std::fmt::Display for ValidationErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ValidationErrorKind::OrphanNode => write!(f, "orphan_node"),
            ValidationErrorKind::ProviderNoBaseUrl => write!(f, "provider_no_base_url"),
            ValidationErrorKind::ProviderNoApiKey => write!(f, "provider_no_api_key"),
            ValidationErrorKind::RouterNoEntries => write!(f, "router_no_entries"),
            ValidationErrorKind::TerminalDisconnected => write!(f, "terminal_disconnected"),
            ValidationErrorKind::EdgeToMissingNode => write!(f, "edge_to_missing_node"),
            ValidationErrorKind::InvalidEdgeType => write!(f, "invalid_edge_type"),
            ValidationErrorKind::NodeDataInvalid => write!(f, "node_data_invalid"),
        }
    }
}

/// Validate a DAG document, returning all errors found.
pub fn validate(doc: &DAGDocument) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Build node lookup
    let node_map: std::collections::HashMap<&str, &DAGNode> =
        doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Collect all node IDs that participate in at least one edge
    let mut connected_nodes: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for edge in &doc.edges {
        connected_nodes.insert(&edge.source);
        connected_nodes.insert(&edge.target);

        // Check edge endpoints exist
        if !node_map.contains_key(edge.source.as_str()) {
            errors.push(ValidationError {
                kind: ValidationErrorKind::EdgeToMissingNode,
                message: format!(
                    "Edge '{}' source node '{}' does not exist",
                    edge.id, edge.source
                ),
            });
        }
        if !node_map.contains_key(edge.target.as_str()) {
            errors.push(ValidationError {
                kind: ValidationErrorKind::EdgeToMissingNode,
                message: format!(
                    "Edge '{}' target node '{}' does not exist",
                    edge.id, edge.target
                ),
            });
        }

        // Check edge type validity
        if let (Some(src), Some(tgt)) =
            (node_map.get(edge.source.as_str()), node_map.get(edge.target.as_str()))
        {
            if !is_valid_edge(src.node_type, tgt.node_type) {
                errors.push(ValidationError {
                    kind: ValidationErrorKind::InvalidEdgeType,
                    message: format!(
                        "Edge '{}' connects {} → {}, which is not allowed",
                        edge.id, src.node_type, tgt.node_type
                    ),
                });
            }
        }
    }

    // Check for orphan nodes (no connected edges)
    for node in &doc.nodes {
        if !connected_nodes.contains(node.id.as_str()) {
            errors.push(ValidationError {
                kind: ValidationErrorKind::OrphanNode,
                message: format!("Node '{}' ({}) has no connected edges", node.id, node.node_type),
            });
        }
    }

    // Validate each node's data
    for node in &doc.nodes {
        match node.node_type {
            NodeType::Provider => {
                if let Ok(data) = serde_json::from_value::<ProviderNodeData>(node.data.clone()) {
                    if data.base_url.trim().is_empty() {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::ProviderNoBaseUrl,
                            message: format!("Provider node '{}' must have a base URL", node.id),
                        });
                    }
                    if data.api_key.trim().is_empty() {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::ProviderNoApiKey,
                            message: format!("Provider node '{}' must have an API key", node.id),
                        });
                    }
                    // Note: Provider can have empty models, meaning all models are available
                    // via the "unified" handle (no model restriction).
                } else {
                    errors.push(ValidationError {
                        kind: ValidationErrorKind::NodeDataInvalid,
                        message: format!("Provider node '{}' has invalid data", node.id),
                    });
                }
            }
            NodeType::Router => {
                if let Ok(data) = serde_json::from_value::<RouterNodeData>(node.data.clone()) {
                    if data.entries.is_empty() && !data.has_default {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::RouterNoEntries,
                            message: format!(
                                "Router node '{}' must have at least one entry or a default route",
                                node.id
                            ),
                        });
                    }
                } else {
                    errors.push(ValidationError {
                        kind: ValidationErrorKind::NodeDataInvalid,
                        message: format!("Router node '{}' has invalid data", node.id),
                    });
                }
            }
            NodeType::Terminal => {
                // Check that Terminal has at least one incoming edge
                let has_incoming = doc.edges.iter().any(|e| e.target == node.id);
                if !has_incoming {
                    errors.push(ValidationError {
                        kind: ValidationErrorKind::TerminalDisconnected,
                        message: format!("Terminal node '{}' must have at least one incoming connection", node.id),
                    });
                }
            }
        }
    }

    errors
}

/// Check if an edge from source type to target type is valid.
/// Allowed: Provider→Router, Provider→Terminal, Router→Terminal
fn is_valid_edge(source: NodeType, target: NodeType) -> bool {
    matches!(
        (source, target),
        (NodeType::Provider, NodeType::Router)
            | (NodeType::Provider, NodeType::Terminal)
            | (NodeType::Router, NodeType::Terminal)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_provider(id: &str, base_url: &str, api_key: &str, models: Vec<ProviderModel>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Provider,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ProviderNodeData {
                label: "P".to_string(),
                description: None,
                api_type: ApiType::OpenAI,
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
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(RouterNodeData {
                label: "R".to_string(),
                description: None,
                entries,
                has_default,
            })
            .unwrap(),
        }
    }

    fn make_terminal(id: &str) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Terminal,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(TerminalNodeData {
                label: "T".to_string(),
                description: None,
                app_type: "custom".to_string(),
            })
            .unwrap(),
        }
    }

    fn make_edge(id: &str, source: &str, target: &str) -> DAGEdge {
        DAGEdge {
            id: id.to_string(),
            source: source.to_string(),
            target: target.to_string(),
            source_handle: None,
            target_handle: None,
            data: None,
        }
    }

    fn valid_doc() -> DAGDocument {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let t = make_terminal("t1");
        let e = make_edge("e1", "p1", "t1");
        DAGDocument {
            nodes: vec![p, t],
            edges: vec![e],
            ..Default::default()
        }
    }

    #[test]
    fn test_valid_provider_to_terminal() {
        let errors = validate(&valid_doc());
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_valid_provider_router_terminal() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let r = make_router("r1", vec![RouterEntry {
            id: "e1".to_string(),
            label: "gpt-4o".to_string(),
            match_type: MatchType::Model,
            pattern: "gpt-4o".to_string(),
        }], false);
        let t = make_terminal("t1");
        let e1 = make_edge("e1", "p1", "r1");
        let e2 = make_edge("e2", "r1", "t1");
        let doc = DAGDocument {
            nodes: vec![p, r, t],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_provider_no_base_url() {
        let p = make_provider("p1", "", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let t = make_terminal("t1");
        let e = make_edge("e1", "p1", "t1");
        let doc = DAGDocument {
            nodes: vec![p, t],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::ProviderNoBaseUrl));
    }

    #[test]
    fn test_provider_no_api_key() {
        let p = make_provider("p1", "https://api.openai.com", "", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let t = make_terminal("t1");
        let e = make_edge("e1", "p1", "t1");
        let doc = DAGDocument {
            nodes: vec![p, t],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::ProviderNoApiKey));
    }

    #[test]
    fn test_provider_no_models_allowed() {
        // Provider without models should be valid (unified handle routes all models)
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![]);
        let t = make_terminal("t1");
        let e = make_edge("e1", "p1", "t1");
        let doc = DAGDocument {
            nodes: vec![p, t],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.is_empty(), "Expected no errors for provider without models, got: {:?}", errors);
    }

    #[test]
    fn test_router_no_entries() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let r = make_router("r1", vec![], false);
        let t = make_terminal("t1");
        let e1 = make_edge("e1", "p1", "r1");
        let e2 = make_edge("e2", "r1", "t1");
        let doc = DAGDocument {
            nodes: vec![p, r, t],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::RouterNoEntries));
    }

    #[test]
    fn test_terminal_disconnected() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let t = make_terminal("t1");
        let doc = DAGDocument {
            nodes: vec![p, t],
            edges: vec![],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::TerminalDisconnected));
    }

    #[test]
    fn test_invalid_edge_type_terminal_to_provider() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let t = make_terminal("t1");
        let e = make_edge("e1", "t1", "p1"); // Terminal → Provider (invalid)
        let doc = DAGDocument {
            nodes: vec![p, t],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::InvalidEdgeType));
    }

    #[test]
    fn test_invalid_edge_type_router_to_router() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let r1 = make_router("r1", vec![RouterEntry {
            id: "e1".to_string(),
            label: "gpt-4o".to_string(),
            match_type: MatchType::Model,
            pattern: "gpt-4o".to_string(),
        }], false);
        let r2 = make_router("r2", vec![], false);
        let e1 = make_edge("e1", "p1", "r1");
        let e2 = make_edge("e2", "r1", "r2"); // Router → Router (invalid)
        let doc = DAGDocument {
            nodes: vec![p, r1, r2],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::InvalidEdgeType));
    }

    #[test]
    fn test_orphan_node() {
        let mut doc = valid_doc();
        let orphan = make_provider("p2", "https://orphan.com", "sk-xxx", vec![
            ProviderModel { id: "m2".to_string(), name: "orphan".to_string(), enabled: true },
        ]);
        doc.nodes.push(orphan);
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::OrphanNode && e.message.contains("p2")));
    }

    #[test]
    fn test_edge_to_missing_node() {
        let p = make_provider("p1", "https://api.openai.com", "sk-123", vec![
            ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true },
        ]);
        let e = make_edge("e1", "p1", "nonexistent");
        let doc = DAGDocument {
            nodes: vec![p],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::EdgeToMissingNode));
    }

    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        let errors = validate(&doc);
        // Empty DAG should have no errors (no nodes to validate)
        assert!(errors.is_empty());
    }

    #[test]
    fn test_invalid_node_data() {
        let mut doc = valid_doc();
        doc.nodes[0].data = serde_json::Value::String("bad data".to_string());
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::NodeDataInvalid));
    }
}
