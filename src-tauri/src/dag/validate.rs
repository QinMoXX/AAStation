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
    /// No listener node found.
    NoListener,
    /// More than one listener node.
    MultipleListeners,
    /// A node has no connected edges (orphan).
    OrphanNode,
    /// A router node has no routing rules.
    RouterNoRules,
    /// A forward node is missing its upstream_url.
    ForwardNoUpstreamUrl,
    /// A forward node is missing its api_key.
    ForwardNoApiKey,
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
            ValidationErrorKind::NoListener => write!(f, "no_listener"),
            ValidationErrorKind::MultipleListeners => write!(f, "multiple_listeners"),
            ValidationErrorKind::OrphanNode => write!(f, "orphan_node"),
            ValidationErrorKind::RouterNoRules => write!(f, "router_no_rules"),
            ValidationErrorKind::ForwardNoUpstreamUrl => write!(f, "forward_no_upstream_url"),
            ValidationErrorKind::ForwardNoApiKey => write!(f, "forward_no_api_key"),
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

    // Check for exactly one Listener
    let listeners: Vec<&DAGNode> = doc
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::Listener)
        .collect();
    match listeners.len() {
        0 => errors.push(ValidationError {
            kind: ValidationErrorKind::NoListener,
            message: "DAG must have exactly one Listener node".to_string(),
        }),
        1 => {}
        _ => errors.push(ValidationError {
            kind: ValidationErrorKind::MultipleListeners,
            message: format!(
                "DAG must have exactly one Listener node, found {}",
                listeners.len()
            ),
        }),
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
            NodeType::Listener => {
                // Validate ListenerNodeData
                if let Ok(data) = serde_json::from_value::<ListenerNodeData>(node.data.clone()) {
                    if data.port == 0 {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::NodeDataInvalid,
                            message: format!("Listener node '{}' has invalid port 0", node.id),
                        });
                    }
                } else {
                    errors.push(ValidationError {
                        kind: ValidationErrorKind::NodeDataInvalid,
                        message: format!("Listener node '{}' has invalid data", node.id),
                    });
                }
            }
            NodeType::Router => {
                // Validate RouterNodeData
                if let Ok(data) = serde_json::from_value::<RouterNodeData>(node.data.clone()) {
                    if data.rules.is_empty() {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::RouterNoRules,
                            message: format!(
                                "Router node '{}' must have at least one routing rule",
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
            NodeType::Forward => {
                // Validate ForwardNodeData
                if let Ok(data) = serde_json::from_value::<ForwardNodeData>(node.data.clone()) {
                    if data.upstream_url.trim().is_empty() {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::ForwardNoUpstreamUrl,
                            message: format!(
                                "Forward node '{}' must have an upstream URL",
                                node.id
                            ),
                        });
                    }
                    if data.api_key.trim().is_empty() {
                        errors.push(ValidationError {
                            kind: ValidationErrorKind::ForwardNoApiKey,
                            message: format!("Forward node '{}' must have an API key", node.id),
                        });
                    }
                } else {
                    errors.push(ValidationError {
                        kind: ValidationErrorKind::NodeDataInvalid,
                        message: format!("Forward node '{}' has invalid data", node.id),
                    });
                }
            }
        }
    }

    errors
}

/// Check if an edge from source type to target type is valid.
/// Allowed: Listener→Router, Listener→Forward, Router→Forward
fn is_valid_edge(source: NodeType, target: NodeType) -> bool {
    matches!(
        (source, target),
        (NodeType::Listener, NodeType::Router)
            | (NodeType::Listener, NodeType::Forward)
            | (NodeType::Router, NodeType::Forward)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_listener(id: &str, port: u16) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Listener,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ListenerNodeData {
                label: "L".to_string(),
                description: None,
                port,
                bind_address: "127.0.0.1".to_string(),
            })
            .unwrap(),
        }
    }

    fn make_router(id: &str, rules: Vec<RoutingRule>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Router,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(RouterNodeData {
                label: "R".to_string(),
                description: None,
                rules,
                default_edge_id: None,
            })
            .unwrap(),
        }
    }

    fn make_forward(id: &str, url: &str, key: &str) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Forward,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ForwardNodeData {
                label: "F".to_string(),
                description: None,
                upstream_url: url.to_string(),
                api_key: key.to_string(),
                extra_headers: HashMap::new(),
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
        let l = make_listener("l1", 9527);
        let f = make_forward("f1", "https://api.example.com", "sk-123");
        let e = make_edge("e1", "l1", "f1");
        DAGDocument {
            nodes: vec![l, f],
            edges: vec![e],
            ..Default::default()
        }
    }

    #[test]
    fn test_valid_listener_to_forward() {
        let errors = validate(&valid_doc());
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_valid_listener_router_forward() {
        let l = make_listener("l1", 9527);
        let r = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: MatchType::PathPrefix,
                pattern: "/v1".to_string(),
                target_edge_id: "e2".to_string(),
            }],
        );
        let f = make_forward("f1", "https://api.example.com", "sk-123");
        let e1 = make_edge("e1", "l1", "r1");
        let e2 = make_edge("e2", "r1", "f1");
        let doc = DAGDocument {
            nodes: vec![l, r, f],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_no_listener() {
        let f = make_forward("f1", "https://api.example.com", "sk-123");
        let _e = make_edge("e1", "n1", "f1"); // source doesn't exist but that's another error
        let mut doc = valid_doc();
        doc.nodes = vec![f];
        doc.edges = vec![];
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::NoListener));
    }

    #[test]
    fn test_multiple_listeners() {
        let mut doc = valid_doc();
        doc.nodes.push(make_listener("l2", 8080));
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::MultipleListeners));
    }

    #[test]
    fn test_orphan_node() {
        let mut doc = valid_doc();
        let orphan = make_forward("f2", "https://orphan.com", "sk-xxx");
        doc.nodes.push(orphan);
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::OrphanNode && e.message.contains("f2")));
    }

    #[test]
    fn test_router_no_rules() {
        let l = make_listener("l1", 9527);
        let r = make_router("r1", vec![]);
        let f = make_forward("f1", "https://api.example.com", "sk-123");
        let e1 = make_edge("e1", "l1", "r1");
        let e2 = make_edge("e2", "r1", "f1");
        let doc = DAGDocument {
            nodes: vec![l, r, f],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::RouterNoRules));
    }

    #[test]
    fn test_forward_no_upstream_url() {
        let l = make_listener("l1", 9527);
        let f = make_forward("f1", "", "sk-123");
        let e = make_edge("e1", "l1", "f1");
        let doc = DAGDocument {
            nodes: vec![l, f],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::ForwardNoUpstreamUrl));
    }

    #[test]
    fn test_forward_no_api_key() {
        let l = make_listener("l1", 9527);
        let f = make_forward("f1", "https://api.example.com", "");
        let e = make_edge("e1", "l1", "f1");
        let doc = DAGDocument {
            nodes: vec![l, f],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::ForwardNoApiKey));
    }

    #[test]
    fn test_edge_to_missing_node() {
        let l = make_listener("l1", 9527);
        let e = make_edge("e1", "l1", "nonexistent");
        let doc = DAGDocument {
            nodes: vec![l],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::EdgeToMissingNode));
    }

    #[test]
    fn test_invalid_edge_type_forward_to_listener() {
        let l = make_listener("l1", 9527);
        let f = make_forward("f1", "https://api.example.com", "sk-123");
        let e = make_edge("e1", "f1", "l1"); // Forward → Listener (invalid)
        let doc = DAGDocument {
            nodes: vec![l, f],
            edges: vec![e],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::InvalidEdgeType));
    }

    #[test]
    fn test_invalid_edge_type_router_to_router() {
        let l = make_listener("l1", 9527);
        let r1 = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: MatchType::PathPrefix,
                pattern: "/v1".to_string(),
                target_edge_id: "e2".to_string(),
            }],
        );
        let r2 = make_router("r2", vec![RoutingRule {
            id: "rule2".to_string(),
            match_type: MatchType::PathPrefix,
            pattern: "/v2".to_string(),
            target_edge_id: "e3".to_string(),
        }]);
        let e1 = make_edge("e1", "l1", "r1");
        let e2 = make_edge("e2", "r1", "r2"); // Router → Router (invalid)
        let doc = DAGDocument {
            nodes: vec![l, r1, r2],
            edges: vec![e1, e2],
            ..Default::default()
        };
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::InvalidEdgeType));
    }

    #[test]
    fn test_invalid_node_data() {
        let mut doc = valid_doc();
        // Corrupt the listener's data
        doc.nodes[0].data = serde_json::Value::String("bad data".to_string());
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::NodeDataInvalid));
    }

    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        let errors = validate(&doc);
        assert!(errors.iter().any(|e| e.kind == ValidationErrorKind::NoListener));
    }

    #[test]
    fn test_multiple_errors_at_once() {
        // No listener + orphan + forward without URL
        let f1 = make_forward("f1", "", "sk-123");
        let f2 = make_forward("f2", "https://api.example.com", "sk-456");
        let doc = DAGDocument {
            nodes: vec![f1, f2],
            edges: vec![make_edge("e1", "f1", "f2")], // invalid edge type too
            ..Default::default()
        };
        let errors = validate(&doc);
        let kinds: Vec<_> = errors.iter().map(|e| e.kind).collect();
        assert!(kinds.contains(&ValidationErrorKind::NoListener));
        assert!(kinds.contains(&ValidationErrorKind::ForwardNoUpstreamUrl));
        assert!(kinds.contains(&ValidationErrorKind::InvalidEdgeType));
    }
}
