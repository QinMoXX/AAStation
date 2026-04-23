#![allow(dead_code, unused_imports)]

use std::collections::HashMap;

use crate::proxy::types::{CompiledRoute, MatchType, RouteTable, RouteTableSet};
use crate::settings::AppSettings;

use super::types::{
    ApplicationNodeData, DAGDocument, DAGEdge, DAGNode, NodeType, ProviderModel,
    ProviderNodeData, SwitcherNodeData,
};

/// Normalize a base URL by ensuring it has a scheme (http:// or https://).
/// If missing, defaults to https://.
fn normalize_base_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

/// Compile a DAG document into a set of route tables, one per Application node.
///
/// Each Application node gets its own RouteTable with a dedicated listen port.
/// The proxy server spawns a separate listener for each Application.
pub fn compile(doc: &DAGDocument, settings: &AppSettings) -> Result<RouteTableSet, CompileError> {
    // Build node lookup map
    let node_map: HashMap<&str, &DAGNode> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Build source→targets edge map for BFS traversal
    let mut outgoing: HashMap<&str, Vec<&DAGEdge>> = HashMap::new();
    for e in &doc.edges {
        outgoing.entry(e.source.as_str()).or_default().push(e);
    }

    let mut tables = Vec::new();

    // Process each Application node independently
    for app_node in &doc.nodes {
        if app_node.node_type != NodeType::Application {
            continue;
        }

        let app_data: ApplicationNodeData = deserialize_node_data(app_node)?;

        // Collect all nodes reachable from this Application (BFS)
        let reachable = bfs_reachable(&app_node.id, &outgoing, &node_map);

        // Collect all Switcher nodes reachable from this Application
        let claude_code_switchers = if app_data.app_type == "claude_code" {
            reachable.iter()
                .filter(|id| node_map.get(id.as_str()).map(|n| n.node_type == NodeType::Switcher).unwrap_or(false))
                .map(|id| id.as_str())
                .collect::<std::collections::HashSet<&str>>()
        } else {
            std::collections::HashSet::new()
        };

        // Build source lookup: (source_node_id, source_handle) → &DAGEdge
        let source_edge_map: HashMap<(&str, &str), &DAGEdge> = doc
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

        // Process all Switcher nodes reachable from this Application
        for node_id in &reachable {
            let node = match node_map.get(node_id.as_str()) {
                Some(n) => n,
                None => continue,
            };
            if node.node_type != NodeType::Switcher {
                continue;
            }

            let switcher_data: SwitcherNodeData = deserialize_node_data(node)?;
            let is_claude_code = claude_code_switchers.contains(node.id.as_str());

            // Process each matcher entry
            for entry in &switcher_data.entries {
                let entry_handle = format!("entry-{}", entry.id);
                let Some(edge) = source_edge_map.get(&(node.id.as_str(), entry_handle.as_str())) else {
                    // Unconnected matcher entries are allowed. They are skipped and simply
                    // won't produce a route. Requests matching this entry will not be forwarded
                    // unless another route/default handles them.
                    continue;
                };

                let provider = resolve_provider(&edge.target, &node_map)?;
                let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

                let target_model = resolve_model_name(
                    edge.target_handle.as_deref(),
                    &provider_data.models,
                );

                routes.push(CompiledRoute {
                    id: format!("route-{}", entry.id),
                    match_type: match entry.match_type {
                        super::types::MatchType::PathPrefix => MatchType::PathPrefix,
                        super::types::MatchType::Header => MatchType::Header,
                        super::types::MatchType::Model => MatchType::Model,
                    },
                    pattern: entry.pattern.clone(),
                    provider_id: provider.id.clone(),
                    provider_label: provider_data.label.clone(),
                    upstream_url: normalize_base_url(&provider_data.base_url),
                    anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                    api_key: provider_data.api_key,
                    extra_headers: HashMap::new(),
                    is_default: false,
                    target_model,
                    fuzzy_match: is_claude_code && matches!(entry.match_type, super::types::MatchType::Model),
                });
            }

            // Process default route for this Switcher
            if switcher_data.has_default {
                let default_handle = "default";
                if let Some(edge) = source_edge_map.get(&(node.id.as_str(), default_handle)) {
                    let provider = resolve_provider(&edge.target, &node_map)?;
                    let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

                    default_route = Some(CompiledRoute {
                        id: format!("route-default-{}", node.id),
                        match_type: MatchType::PathPrefix,
                        pattern: String::new(),
                        provider_id: provider.id.clone(),
                        provider_label: provider_data.label.clone(),
                        upstream_url: normalize_base_url(&provider_data.base_url),
                        anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                        api_key: provider_data.api_key,
                        extra_headers: HashMap::new(),
                        is_default: true,
                        target_model: String::new(),
                        fuzzy_match: false,
                    });
                }
            }
        }

        // Process Application nodes directly connected to a Provider (no Switcher)
        for edge in &doc.edges {
            if edge.source != app_node.id {
                continue;
            }

            let target_node = node_map.get(edge.target.as_str());
            if let Some(target) = target_node {
                if target.node_type == NodeType::Provider {
                    let provider_data: ProviderNodeData = deserialize_node_data(target)?;
                    if default_route.is_none() {
                        default_route = Some(CompiledRoute {
                            id: format!("route-direct-{}", app_node.id),
                            match_type: MatchType::PathPrefix,
                            pattern: String::new(),
                            provider_id: target.id.clone(),
                            provider_label: provider_data.label.clone(),
                            upstream_url: normalize_base_url(&provider_data.base_url),
                            anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                            api_key: provider_data.api_key,
                            extra_headers: HashMap::new(),
                            is_default: true,
                            target_model: String::new(),
                            fuzzy_match: false,
                        });
                    }
                }
            }
        }

        tables.push(RouteTable {
            app_id: app_node.id.clone(),
            app_label: app_data.label.clone(),
            listen_port: app_data.listen_port,
            listen_address: settings.listen_address.clone(),
            routes,
            default_route,
        });
    }

    Ok(RouteTableSet {
        listen_address: settings.listen_address.clone(),
        tables,
    })
}

/// BFS from a starting node, returning all reachable node IDs.
/// Stops at Provider nodes (they are leaf nodes).
fn bfs_reachable<'a>(
    start_id: &str,
    outgoing: &HashMap<&str, Vec<&'a DAGEdge>>,
    node_map: &HashMap<&str, &'a DAGNode>,
) -> Vec<String> {
    let mut visited = std::collections::HashSet::new();
    let mut result = Vec::new();
    let mut queue = vec![start_id];

    while let Some(current_id) = queue.pop() {
        if !visited.insert(current_id.to_string()) {
            continue;
        }
        result.push(current_id.to_string());

        if let Some(edges) = outgoing.get(current_id) {
            for edge in edges {
                if let Some(target_node) = node_map.get(edge.target.as_str()) {
                    // Don't traverse through Provider nodes (they are leaf nodes)
                    if target_node.node_type != NodeType::Provider {
                        queue.push(edge.target.as_str());
                    }
                }
            }
        }
    }

    result
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
        return Err(CompileError::TargetNotProvider(node_id.to_string()));
    }

    Ok(*node)
}

/// Find all Switcher node IDs that are reachable from a `claude_code` Application node.
///
/// This is used to determine which Switcher routes should use fuzzy (substring) matching
/// for model patterns, since Claude Code may send model names like
/// "claude-haiku-4-5-20251001" that should match pattern "claude-haiku".
fn find_claude_code_switchers<'a>(
    doc: &'a DAGDocument,
    node_map: &HashMap<&str, &'a DAGNode>,
) -> std::collections::HashSet<&'a str> {
    let mut result = std::collections::HashSet::new();

    // Build source→targets edge map for BFS traversal
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &doc.edges {
        outgoing.entry(e.source.as_str()).or_default().push(e.target.as_str());
    }

    for node in &doc.nodes {
        if node.node_type != NodeType::Application {
            continue;
        }
        // Check if this is a claude_code application
        let app_data: Result<ApplicationNodeData, _> = serde_json::from_value(node.data.clone());
        if let Ok(data) = &app_data {
            if data.app_type != "claude_code" {
                continue;
            }
        } else {
            continue;
        }

        // BFS from this Application node to find all reachable Switcher nodes
        let mut visited = std::collections::HashSet::new();
        let mut queue = vec![node.id.as_str()];
        while let Some(current_id) = queue.pop() {
            if !visited.insert(current_id) {
                continue;
            }

            if let Some(targets) = outgoing.get(current_id) {
                for target_id in targets {
                    if let Some(target_node) = node_map.get(target_id) {
                        if target_node.node_type == NodeType::Switcher {
                            result.insert(target_node.id.as_str());
                        }
                        // Continue traversing through non-Provider nodes
                        if target_node.node_type != NodeType::Provider {
                            queue.push(target_id);
                        }
                    }
                }
            }
        }
    }

    result
}

/// Resolve the target model name from an edge's target handle.
///
/// When a Switcher entry handle connects to a Provider model sub-handle (e.g. "model-{uuid}"),
/// the target model should be the model name from that specific ProviderModel.
/// If the target_handle is not a model sub-handle (e.g. "unified"), returns empty string
/// (no model replacement).
fn resolve_model_name(
    target_handle: Option<&str>,
    models: &[ProviderModel],
) -> String {
    if let Some(handle) = target_handle {
        if let Some(model_id) = handle.strip_prefix("model-") {
            if let Some(model) = models.iter().find(|m| m.id == model_id) {
                return model.name.clone();
            }
        }
    }
    String::new()
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
    #[error("matcher entry '{0}' has no connected edge")]
    EntryEdgeNotFound(String),
    #[error("default edge for switcher '{0}' not found")]
    DefaultEdgeNotFound(String),
    #[error("edge points to missing node '{0}'")]
    EdgeToMissingNode(String),
    #[error("target node '{0}' is not a Provider node")]
    TargetNotProvider(String),
    #[error("failed to deserialize data for node '{0}': {1}")]
    NodeDataDeserializeFailed(String, String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::types::{
        DAGEdge, DAGDocument, DAGNode, MatchType as DagMatchType, NodeType, Position,
        ProviderModel, ProviderNodeData, SwitcherEntry, SwitcherNodeData, ApplicationNodeData,
    };
    use crate::proxy::types::MatchType as ProxyMatchType;
    use std::collections::HashMap;

    fn default_settings() -> AppSettings {
        AppSettings {
            listen_port_range: "9527-9537".to_string(),
            listen_address: "127.0.0.1".to_string(),
            proxy_auth_token: String::new(),
            log_dir_max_mb: 500,
        }
    }

    fn make_provider(id: &str, label: &str, base_url: &str, api_key: &str, models: Vec<ProviderModel>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Provider,
            position: Position { x: 400.0, y: 0.0 },
            data: serde_json::to_value(ProviderNodeData {
                label: label.to_string(),
                description: None,
                base_url: base_url.to_string(),
                anthropic_base_url: None,
                api_key: api_key.to_string(),
                models,
            })
            .unwrap(),
        }
    }

    fn make_switcher(id: &str, entries: Vec<SwitcherEntry>, has_default: bool) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Switcher,
            position: Position { x: 200.0, y: 0.0 },
            data: serde_json::to_value(SwitcherNodeData {
                label: "Switcher".to_string(),
                description: None,
                entries,
                has_default,
            })
            .unwrap(),
        }
    }

    fn make_application(id: &str, label: &str, app_type: &str, listen_port: u16) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Application,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ApplicationNodeData {
                label: label.to_string(),
                description: None,
                app_type: app_type.to_string(),
                listen_port,
                application_handler: String::new(),
                unpublish_handler: String::new(),
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
    fn test_application_to_switcher_to_provider() {
        let model_id = "model-1";
        let entry_id = "entry-1";

        let provider = make_provider(
            "p1", "OpenAI",
            "https://api.openai.com/v1", "sk-test",
            vec![ProviderModel { id: model_id.to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let switcher = make_switcher(
            "s1",
            vec![SwitcherEntry {
                id: entry_id.to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            false,
        );

        let application = make_application("a1", "Claude Code", "claude_code", 9527);

        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            make_edge("e2", "s1", "p1", Some(&format!("entry-{}", entry_id)), Some(&format!("model-{}", model_id))),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider],
            edges,
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        assert_eq!(set.tables.len(), 1);
        let table = &set.tables[0];
        assert_eq!(table.app_id, "a1");
        assert_eq!(table.listen_port, 9527);
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[0].pattern, "gpt-4o");
        assert_eq!(table.routes[0].upstream_url, "https://api.openai.com/v1");
        assert_eq!(table.routes[0].target_model, "gpt-4o");
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_application_to_switcher_with_default() {
        let entry_id = "entry-1";

        let provider_a = make_provider(
            "pa", "OpenAI",
            "https://api.openai.com/v1", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let provider_b = make_provider(
            "pb", "Anthropic",
            "https://api.anthropic.com/v1", "sk-ant-key",
            vec![],
        );

        let switcher = make_switcher(
            "s1",
            vec![SwitcherEntry {
                id: entry_id.to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            true,
        );

        let application = make_application("a1", "Claude Code", "claude_code", 9527);

        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            make_edge("e2", "s1", "pa", Some(&format!("entry-{}", entry_id)), Some("model-m1")),
            make_edge("e3", "s1", "pb", Some("default"), Some("unified")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider_a, provider_b],
            edges,
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        let table = &set.tables[0];
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://api.anthropic.com/v1");
    }

    #[test]
    fn test_application_direct_to_provider() {
        let provider = make_provider(
            "p1", "OpenAI",
            "https://api.openai.com/v1", "sk-test",
            vec![],
        );

        let application = make_application("a1", "Claude Code", "claude_code", 9527);

        let edges = vec![
            make_edge("e1", "a1", "p1", Some("output"), Some("unified")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, provider],
            edges,
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        let table = &set.tables[0];
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://api.openai.com/v1");
    }

    #[test]
    fn test_unconnected_switcher_entry_is_skipped() {
        let provider = make_provider(
            "p1", "OpenAI",
            "https://api.openai.com/v1", "sk-test",
            vec![],
        );

        let switcher = make_switcher(
            "s1",
            vec![SwitcherEntry {
                id: "entry-1".to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            false,
        );

        let application = make_application("a1", "App", "listener", 9527);

        // Application connects to switcher but switcher entry has no edge to provider
        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider],
            edges,
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        assert_eq!(set.tables.len(), 1);
        let table = &set.tables[0];
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_multiple_applications_isolated() {
        // Two Application nodes, each with their own Switcher and Provider
        let provider_a = make_provider(
            "pa", "OpenAI",
            "https://api.openai.com/v1", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let provider_b = make_provider(
            "pb", "Anthropic",
            "https://api.anthropic.com/v1", "sk-ant",
            vec![ProviderModel { id: "m2".to_string(), name: "claude-sonnet-4".to_string(), enabled: true }],
        );

        let switcher_a = make_switcher(
            "sa",
            vec![SwitcherEntry {
                id: "entry-a1".to_string(),
                label: "gpt-4o".to_string(),
                match_type: DagMatchType::Model,
                pattern: "gpt-4o".to_string(),
            }],
            false,
        );

        let switcher_b = make_switcher(
            "sb",
            vec![SwitcherEntry {
                id: "entry-b1".to_string(),
                label: "claude-sonnet-4".to_string(),
                match_type: DagMatchType::Model,
                pattern: "claude-sonnet-4".to_string(),
            }],
            false,
        );

        let app_a = make_application("a1", "Listener", "listener", 9527);
        let app_b = make_application("a2", "Claude Code", "claude_code", 9528);

        let edges = vec![
            make_edge("e1", "a1", "sa", Some("output"), Some("input")),
            make_edge("e2", "sa", "pa", Some("entry-entry-a1"), Some("model-m1")),
            make_edge("e3", "a2", "sb", Some("output"), Some("input")),
            make_edge("e4", "sb", "pb", Some("entry-entry-b1"), Some("model-m2")),
        ];

        let doc = DAGDocument {
            nodes: vec![app_a, app_b, switcher_a, switcher_b, provider_a, provider_b],
            edges,
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        assert_eq!(set.tables.len(), 2);

        // Find tables by app_id
        let table_a = set.tables.iter().find(|t| t.app_id == "a1").unwrap();
        let table_b = set.tables.iter().find(|t| t.app_id == "a2").unwrap();

        assert_eq!(table_a.listen_port, 9527);
        assert_eq!(table_a.routes.len(), 1);
        assert_eq!(table_a.routes[0].pattern, "gpt-4o");
        assert_eq!(table_a.routes[0].target_model, "gpt-4o");
        assert!(!table_a.routes[0].fuzzy_match);

        assert_eq!(table_b.listen_port, 9528);
        assert_eq!(table_b.routes.len(), 1);
        assert_eq!(table_b.routes[0].pattern, "claude-sonnet-4");
        assert_eq!(table_b.routes[0].target_model, "claude-sonnet-4");
        assert!(table_b.routes[0].fuzzy_match); // claude_code → fuzzy match enabled
    }

    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        let set = compile(&doc, &default_settings()).unwrap();
        assert!(set.tables.is_empty());
    }
}
