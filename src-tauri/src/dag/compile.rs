#![allow(dead_code, unused_imports)]

use std::collections::HashMap;

use crate::proxy::types::{CompiledRoute, MatchType, RouteTable};

use super::types::{
    DAGDocument, DAGEdge, DAGNode, ForwardNodeData, ListenerNodeData, NodeType, RouterNodeData,
};

/// Compile a DAG document into a flat route table.
///
/// Traversal logic:
/// 1. Find the single Listener node → extract listen_port / listen_address
/// 2. Follow edges from Listener:
///    - Listener → Forward (direct): create a default CompiledRoute
///    - Listener → Router: for each routing rule, follow its target_edge_id to the
///      corresponding edge → target Forward node → create a CompiledRoute
///    - Router.default_edge_id → target Forward node → create the default CompiledRoute
pub fn compile(doc: &DAGDocument) -> Result<RouteTable, CompileError> {
    // Build node lookup map
    let node_map: HashMap<&str, &DAGNode> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Find the single Listener node
    let listeners: Vec<&DAGNode> = doc
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::Listener)
        .collect();

    if listeners.is_empty() {
        return Err(CompileError::NoListener);
    }
    if listeners.len() > 1 {
        return Err(CompileError::MultipleListeners);
    }

    let listener_node = listeners[0];
    let listener_data: ListenerNodeData = deserialize_node_data(listener_node)?;

    // Collect routes by traversing edges from the Listener
    let mut routes: Vec<CompiledRoute> = Vec::new();
    let mut default_route: Option<CompiledRoute> = None;

    // Find all edges originating from the Listener
    let listener_edges: Vec<&DAGEdge> = doc
        .edges
        .iter()
        .filter(|e| e.source == listener_node.id)
        .collect();

    for edge in &listener_edges {
        let target_node = node_map
            .get(edge.target.as_str())
            .ok_or_else(|| CompileError::EdgeToMissingNode(edge.id.clone()))?;

        match target_node.node_type {
            NodeType::Forward => {
                // Direct Listener → Forward: this becomes a default route
                let forward_data: ForwardNodeData = deserialize_node_data(target_node)?;
                let route = CompiledRoute {
                    id: format!("route-{}", edge.id),
                    match_type: MatchType::PathPrefix,
                    pattern: "/".to_string(),
                    upstream_url: forward_data.upstream_url,
                    api_key: forward_data.api_key,
                    extra_headers: forward_data.extra_headers,
                    is_default: true,
                };
                // If multiple direct Listener→Forward edges exist, last one wins
                default_route = Some(route);
            }
            NodeType::Router => {
                // Listener → Router: expand routing rules
                let router_data: RouterNodeData = deserialize_node_data(target_node)?;

                // Find edges originating from this Router node
                let router_edges: Vec<&DAGEdge> = doc
                    .edges
                    .iter()
                    .filter(|e| e.source == target_node.id)
                    .collect();

                let router_edge_map: HashMap<&str, &DAGEdge> = router_edges
                    .into_iter()
                    .map(|e| (e.id.as_str(), e))
                    .collect();

                // Process each routing rule
                for rule in &router_data.rules {
                    // Find the edge this rule points to via target_edge_id
                    let rule_edge = router_edge_map
                        .get(rule.target_edge_id.as_str())
                        .ok_or_else(|| {
                            CompileError::RuleEdgeNotFound(
                                rule.id.clone(),
                                rule.target_edge_id.clone(),
                            )
                        })?;

                    // Find the Forward node at the end of this edge
                    let forward_node = node_map
                        .get(rule_edge.target.as_str())
                        .ok_or_else(|| {
                            CompileError::EdgeToMissingNode(rule_edge.id.clone())
                        })?;

                    if forward_node.node_type != NodeType::Forward {
                        return Err(CompileError::RouterTargetNotForward(
                            rule.id.clone(),
                        ));
                    }

                    let forward_data: ForwardNodeData = deserialize_node_data(forward_node)?;

                    routes.push(CompiledRoute {
                        id: format!("route-{}", rule.id),
                        match_type: match rule.match_type {
                            super::types::MatchType::PathPrefix => MatchType::PathPrefix,
                            super::types::MatchType::Header => MatchType::Header,
                            super::types::MatchType::Model => MatchType::Model,
                        },
                        pattern: rule.pattern.clone(),
                        upstream_url: forward_data.upstream_url,
                        api_key: forward_data.api_key,
                        extra_headers: forward_data.extra_headers,
                        is_default: false,
                    });
                }

                // Process default edge for the Router
                if let Some(ref default_edge_id) = router_data.default_edge_id {
                    let default_edge = router_edge_map
                        .get(default_edge_id.as_str())
                        .ok_or_else(|| {
                            CompileError::DefaultEdgeNotFound(default_edge_id.clone())
                        })?;

                    let forward_node = node_map
                        .get(default_edge.target.as_str())
                        .ok_or_else(|| {
                            CompileError::EdgeToMissingNode(default_edge.id.clone())
                        })?;

                    if forward_node.node_type != NodeType::Forward {
                        return Err(CompileError::DefaultTargetNotForward(
                            default_edge_id.clone(),
                        ));
                    }

                    let forward_data: ForwardNodeData = deserialize_node_data(forward_node)?;

                    default_route = Some(CompiledRoute {
                        id: format!("route-default-{}", default_edge_id),
                        match_type: MatchType::PathPrefix,
                        pattern: String::new(),
                        upstream_url: forward_data.upstream_url,
                        api_key: forward_data.api_key,
                        extra_headers: forward_data.extra_headers,
                        is_default: true,
                    });
                }
            }
            NodeType::Listener => {
                return Err(CompileError::ListenerToListener);
            }
        }
    }

    Ok(RouteTable {
        listen_port: listener_data.port,
        listen_address: listener_data.bind_address,
        routes,
        default_route,
    })
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
    #[error("no listener node found")]
    NoListener,
    #[error("multiple listener nodes found; exactly one is required")]
    MultipleListeners,
    #[error("edge '{0}' points to a node that does not exist")]
    EdgeToMissingNode(String),
    #[error("routing rule '{0}' references edge '{1}' which does not exist or does not originate from the router")]
    RuleEdgeNotFound(String, String),
    #[error("routing rule '{0}' targets a non-Forward node")]
    RouterTargetNotForward(String),
    #[error("default edge '{0}' not found among router's outgoing edges")]
    DefaultEdgeNotFound(String),
    #[error("default edge '{0}' targets a non-Forward node")]
    DefaultTargetNotForward(String),
    #[error("listener node cannot connect to another listener")]
    ListenerToListener,
    #[error("failed to deserialize data for node '{0}': {1}")]
    NodeDataDeserializeFailed(String, String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::types::{
        DAGEdge, DAGDocument, DAGNode, ForwardNodeData, ListenerNodeData, MatchType as DagMatchType,
        NodeType, Position, RouterNodeData, RoutingRule,
    };
    use crate::proxy::types::MatchType as ProxyMatchType;
    use std::collections::HashMap;

    fn make_listener(id: &str, port: u16) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Listener,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ListenerNodeData {
                label: "Listener".to_string(),
                description: None,
                port,
                bind_address: "127.0.0.1".to_string(),
            })
            .unwrap(),
        }
    }

    fn make_router(id: &str, rules: Vec<RoutingRule>, default_edge_id: Option<&str>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Router,
            position: Position { x: 200.0, y: 0.0 },
            data: serde_json::to_value(RouterNodeData {
                label: "Router".to_string(),
                description: None,
                rules,
                default_edge_id: default_edge_id.map(|s| s.to_string()),
            })
            .unwrap(),
        }
    }

    fn make_forward(id: &str, upstream_url: &str, api_key: &str) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Forward,
            position: Position { x: 400.0, y: 0.0 },
            data: serde_json::to_value(ForwardNodeData {
                label: format!("Forward-{}", id),
                description: None,
                upstream_url: upstream_url.to_string(),
                api_key: api_key.to_string(),
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

    #[test]
    fn test_listener_to_forward_direct() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.anthropic.com", "sk-test");
        let edge = make_edge("e1", "l1", "f1");

        let doc = DAGDocument {
            nodes: vec![listener, forward],
            edges: vec![edge],
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        assert_eq!(table.listen_port, 9527);
        assert_eq!(table.listen_address, "127.0.0.1");
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_some());
        let dr = table.default_route.unwrap();
        assert_eq!(dr.upstream_url, "https://api.anthropic.com");
        assert_eq!(dr.api_key, "sk-test");
        assert!(dr.is_default);
    }

    #[test]
    fn test_listener_router_forward() {
        let listener = make_listener("l1", 8080);
        let forward_a = make_forward("fa", "https://api-a.com", "key-a");
        let forward_b = make_forward("fb", "https://api-b.com", "key-b");
        let forward_default = make_forward("fd", "https://default.com", "key-d");

        let router = make_router(
            "r1",
            vec![
                RoutingRule {
                    id: "rule1".to_string(),
                    match_type: DagMatchType::PathPrefix,
                    pattern: "/v1/messages".to_string(),
                    target_edge_id: "e-r-fa".to_string(),
                },
                RoutingRule {
                    id: "rule2".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "gpt-4o".to_string(),
                    target_edge_id: "e-r-fb".to_string(),
                },
            ],
            Some("e-r-fd"),
        );

        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-fa", "r1", "fa"),
            make_edge("e-r-fb", "r1", "fb"),
            make_edge("e-r-fd", "r1", "fd"),
        ];

        let doc = DAGDocument {
            nodes: vec![listener, router, forward_a, forward_b, forward_default],
            edges,
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        assert_eq!(table.listen_port, 8080);
        assert_eq!(table.routes.len(), 2);

        // First route: path_prefix /v1/messages → forward_a
        assert_eq!(table.routes[0].match_type, ProxyMatchType::PathPrefix);
        assert_eq!(table.routes[0].pattern, "/v1/messages");
        assert_eq!(table.routes[0].upstream_url, "https://api-a.com");

        // Second route: model gpt-4o → forward_b
        assert_eq!(table.routes[1].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[1].pattern, "gpt-4o");
        assert_eq!(table.routes[1].upstream_url, "https://api-b.com");

        // Default route → forward_default
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://default.com");
        assert!(table.default_route.as_ref().unwrap().is_default);
    }

    #[test]
    fn test_no_listener() {
        let forward = make_forward("f1", "https://api.com", "key");
        let doc = DAGDocument {
            nodes: vec![forward],
            edges: vec![],
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::NoListener)));
    }

    #[test]
    fn test_multiple_listeners() {
        let l1 = make_listener("l1", 8080);
        let l2 = make_listener("l2", 9090);
        let doc = DAGDocument {
            nodes: vec![l1, l2],
            edges: vec![],
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::MultipleListeners)));
    }

    #[test]
    fn test_edge_to_missing_node() {
        let listener = make_listener("l1", 9527);
        let edge = make_edge("e1", "l1", "nonexistent");
        let doc = DAGDocument {
            nodes: vec![listener],
            edges: vec![edge],
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::EdgeToMissingNode(_))));
    }

    #[test]
    fn test_rule_edge_not_found() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.com", "key");
        let router = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: DagMatchType::PathPrefix,
                pattern: "/v1".to_string(),
                target_edge_id: "nonexistent-edge".to_string(),
            }],
            None,
        );
        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-f1", "r1", "f1"),
        ];
        let doc = DAGDocument {
            nodes: vec![listener, router, forward],
            edges,
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::RuleEdgeNotFound(_, _))));
    }

    #[test]
    fn test_default_edge_not_found() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.com", "key");
        let router = make_router("r1", vec![], Some("nonexistent-edge"));
        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-f1", "r1", "f1"),
        ];
        let doc = DAGDocument {
            nodes: vec![listener, router, forward],
            edges,
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::DefaultEdgeNotFound(_))));
    }

    #[test]
    fn test_router_target_not_forward() {
        let listener = make_listener("l1", 9527);
        // Router points to another router (invalid)
        let router_inner = make_router("r2", vec![], None);
        let router_outer = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: DagMatchType::PathPrefix,
                pattern: "/v1".to_string(),
                target_edge_id: "e-r-r2".to_string(),
            }],
            None,
        );
        let edges = vec![
            make_edge("e-l-r1", "l1", "r1"),
            make_edge("e-r-r2", "r1", "r2"),
        ];
        let doc = DAGDocument {
            nodes: vec![listener, router_outer, router_inner],
            edges,
            ..Default::default()
        };
        assert!(matches!(compile(&doc), Err(CompileError::RouterTargetNotForward(_))));
    }

    #[test]
    fn test_header_routing_rule() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.com", "key");
        let router = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: DagMatchType::Header,
                pattern: "X-Model:gpt-4o".to_string(),
                target_edge_id: "e-r-f1".to_string(),
            }],
            None,
        );
        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-f1", "r1", "f1"),
        ];
        let doc = DAGDocument {
            nodes: vec![listener, router, forward],
            edges,
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Header);
        assert_eq!(table.routes[0].pattern, "X-Model:gpt-4o");
    }

    #[test]
    fn test_forward_with_extra_headers() {
        let mut extra = HashMap::new();
        extra.insert("X-Custom".to_string(), "value".to_string());

        let listener = make_listener("l1", 9527);
        let mut forward_node = make_forward("f1", "https://api.com", "key");
        // Override forward data with extra headers
        forward_node.data = serde_json::to_value(ForwardNodeData {
            label: "Forward".to_string(),
            description: None,
            upstream_url: "https://api.com".to_string(),
            api_key: "key".to_string(),
            extra_headers: extra,
        })
        .unwrap();

        let edge = make_edge("e1", "l1", "f1");
        let doc = DAGDocument {
            nodes: vec![listener, forward_node],
            edges: vec![edge],
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        let dr = table.default_route.unwrap();
        assert_eq!(dr.extra_headers.get("X-Custom").unwrap(), "value");
    }

    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        assert!(matches!(compile(&doc), Err(CompileError::NoListener)));
    }

    /// Model-only routing: compile a DAG with a single model routing rule.
    #[test]
    fn test_model_routing_only() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://model-api.com", "sk-model");
        let router = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule-model".to_string(),
                match_type: DagMatchType::Model,
                pattern: "claude-sonnet-4-20250514".to_string(),
                target_edge_id: "e-r-f1".to_string(),
            }],
            None,
        );
        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-f1", "r1", "f1"),
        ];
        let doc = DAGDocument {
            nodes: vec![listener, router, forward],
            edges,
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[0].pattern, "claude-sonnet-4-20250514");
        assert_eq!(table.routes[0].upstream_url, "https://model-api.com");
        assert!(table.default_route.is_none());
    }

    /// Multiple rules with different match types in a single router.
    #[test]
    fn test_mixed_match_types_in_router() {
        let listener = make_listener("l1", 9090);
        let fa = make_forward("fa", "https://path-api.com", "key-a");
        let fb = make_forward("fb", "https://header-api.com", "key-b");
        let fc = make_forward("fc", "https://model-api.com", "key-c");
        let fd = make_forward("fd", "https://default-api.com", "key-d");

        let router = make_router(
            "r1",
            vec![
                RoutingRule {
                    id: "rule-path".to_string(),
                    match_type: DagMatchType::PathPrefix,
                    pattern: "/v1/chat".to_string(),
                    target_edge_id: "e-r-fa".to_string(),
                },
                RoutingRule {
                    id: "rule-header".to_string(),
                    match_type: DagMatchType::Header,
                    pattern: "X-Provider:openai".to_string(),
                    target_edge_id: "e-r-fb".to_string(),
                },
                RoutingRule {
                    id: "rule-model".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "gpt-4o".to_string(),
                    target_edge_id: "e-r-fc".to_string(),
                },
            ],
            Some("e-r-fd"),
        );

        let edges = vec![
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-fa", "r1", "fa"),
            make_edge("e-r-fb", "r1", "fb"),
            make_edge("e-r-fc", "r1", "fc"),
            make_edge("e-r-fd", "r1", "fd"),
        ];

        let doc = DAGDocument {
            nodes: vec![listener, router, fa, fb, fc, fd],
            edges,
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        assert_eq!(table.routes.len(), 3);

        // Verify all match types are correct
        assert_eq!(table.routes[0].match_type, ProxyMatchType::PathPrefix);
        assert_eq!(table.routes[1].match_type, ProxyMatchType::Header);
        assert_eq!(table.routes[2].match_type, ProxyMatchType::Model);

        // Verify default route
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://default-api.com");
    }

    /// Orphan forward node: compile still succeeds (orphan is ignored at compile time,
    /// validation catches it separately).
    #[test]
    fn test_orphan_forward_node_compiles() {
        let listener = make_listener("l1", 9527);
        let forward_connected = make_forward("f1", "https://api.com", "key");
        let forward_orphan = make_forward("f2", "https://orphan.com", "key2");
        let edge = make_edge("e1", "l1", "f1");

        let doc = DAGDocument {
            nodes: vec![listener, forward_connected, forward_orphan],
            edges: vec![edge],
            ..Default::default()
        };

        // Compile should succeed — only connected nodes are traversed
        let table = compile(&doc).unwrap();
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.unwrap().upstream_url, "https://api.com");
    }

    /// Listener connected to both a Forward (default) and a Router (rules).
    /// The last direct Forward edge wins as default; Router rules are also compiled.
    #[test]
    fn test_listener_with_both_direct_forward_and_router() {
        let listener = make_listener("l1", 3000);
        let forward_direct = make_forward("fd", "https://direct.com", "key-d");
        let forward_routed = make_forward("fr", "https://routed.com", "key-r");
        let router = make_router(
            "r1",
            vec![RoutingRule {
                id: "rule1".to_string(),
                match_type: DagMatchType::PathPrefix,
                pattern: "/v1".to_string(),
                target_edge_id: "e-r-fr".to_string(),
            }],
            None,
        );

        let edges = vec![
            make_edge("e-l-fd", "l1", "fd"),
            make_edge("e-l-r", "l1", "r1"),
            make_edge("e-r-fr", "r1", "fr"),
        ];

        let doc = DAGDocument {
            nodes: vec![listener, forward_direct, router, forward_routed],
            edges,
            ..Default::default()
        };

        let table = compile(&doc).unwrap();
        // Router rule is compiled
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].upstream_url, "https://routed.com");
        // Direct forward becomes default
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.unwrap().upstream_url, "https://direct.com");
    }

    /// Compile with node data deserialization failure (corrupt data).
    #[test]
    fn test_node_data_deserialize_failure() {
        let mut listener = make_listener("l1", 9527);
        // Corrupt the listener data
        listener.data = serde_json::Value::String("not valid listener data".to_string());

        let doc = DAGDocument {
            nodes: vec![listener],
            edges: vec![],
            ..Default::default()
        };

        assert!(matches!(
            compile(&doc),
            Err(CompileError::NodeDataDeserializeFailed(_, _))
        ));
    }

    /// Verify that the compiled RouteTable can be serialized to JSON and back.
    #[test]
    fn test_route_table_serialization_roundtrip() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.com", "sk-test");
        let edge = make_edge("e1", "l1", "f1");

        let doc = DAGDocument {
            nodes: vec![listener, forward],
            edges: vec![edge],
            ..Default::default()
        };

        let table = compile(&doc).unwrap();

        // Serialize and deserialize
        let json = serde_json::to_string(&table).unwrap();
        let table_back: RouteTable = serde_json::from_str(&json).unwrap();

        assert_eq!(table_back.listen_port, 9527);
        assert_eq!(table_back.listen_address, "127.0.0.1");
        assert_eq!(table_back.default_route.unwrap().upstream_url, "https://api.com");
    }

    /// Full pipeline test: validate → compile.
    /// A valid DAG should pass validation and compile successfully.
    #[test]
    fn test_validate_then_compile_valid_dag() {
        let listener = make_listener("l1", 9527);
        let forward = make_forward("f1", "https://api.anthropic.com", "sk-ant-key");
        let edge = make_edge("e1", "l1", "f1");

        let doc = DAGDocument {
            nodes: vec![listener, forward],
            edges: vec![edge],
            ..Default::default()
        };

        // Validate
        let errors = crate::dag::validate::validate(&doc);
        assert!(errors.is_empty(), "Expected no validation errors, got: {:?}", errors);

        // Compile
        let table = compile(&doc).unwrap();
        assert_eq!(table.listen_port, 9527);
        assert!(table.default_route.is_some());
    }

    /// Invalid DAG should fail validation, and if we skip validation,
    /// compile may also fail.
    #[test]
    fn test_validate_then_compile_invalid_dag() {
        let forward = make_forward("f1", "https://api.com", "key");
        let doc = DAGDocument {
            nodes: vec![forward],
            edges: vec![],
            ..Default::default()
        };

        // Validation should catch no listener
        let errors = crate::dag::validate::validate(&doc);
        assert!(errors.iter().any(|e| e.kind == crate::dag::validate::ValidationErrorKind::NoListener));

        // Compile should also fail
        assert!(matches!(compile(&doc), Err(CompileError::NoListener)));
    }
}
