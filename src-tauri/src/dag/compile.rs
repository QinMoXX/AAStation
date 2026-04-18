#![allow(dead_code, unused_imports)]

use std::collections::HashMap;

use crate::proxy::types::{ApiType, CompiledRoute, MatchType, RouteTable};
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

/// Compile a DAG document into a flat route table.
///
/// Traversal logic (left-to-right flow: Application → Switcher → Provider):
/// 1. Get listen_port / listen_address from settings (not from a Listener node)
/// 2. Build handle → edge lookup maps for efficient traversal
/// 3. For each Switcher node:
///    - For each entry: find the edge sourcing from this entry's handle → trace to Provider
///    - For the "default" handle: find the edge → trace to Provider
/// 4. For Application nodes directly connected to a Provider (no Switcher):
///    - Build a default/catch-all route
pub fn compile(doc: &DAGDocument, settings: &AppSettings) -> Result<RouteTable, CompileError> {
    // Build node lookup map
    let node_map: HashMap<&str, &DAGNode> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

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

    // Determine which Switcher nodes are fed by a claude_code Application
    let claude_code_switchers = find_claude_code_switchers(doc, &node_map);

    let mut routes: Vec<CompiledRoute> = Vec::new();
    let mut default_route: Option<CompiledRoute> = None;

    // Process all Switcher nodes
    for node in &doc.nodes {
        if node.node_type != NodeType::Switcher {
            continue;
        }

        let switcher_data: SwitcherNodeData = deserialize_node_data(node)?;
        let is_claude_code = claude_code_switchers.contains(&node.id.as_str());

        // Process each matcher entry
        for entry in &switcher_data.entries {
            // Find the edge sourcing from this entry's source handle
            let entry_handle = format!("entry-{}", entry.id);
            let edge = source_edge_map
                .get(&(node.id.as_str(), entry_handle.as_str()))
                .ok_or_else(|| CompileError::EntryEdgeNotFound(entry.id.clone()))?;

            // Trace to the target Provider
            let provider = resolve_provider(&edge.target, &node_map)?;
            let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

            // Resolve target_model from the edge's target_handle.
            // When the edge targets a Provider model sub-handle (e.g. "model-{uuid}"),
            // use that model's name as the target model to replace in the request body.
            // When no matching rule is met, the default route (via Provider main handle)
            // keeps target_model empty, forwarding without model replacement.
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
                upstream_url: normalize_base_url(&provider_data.base_url),
                anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                api_key: provider_data.api_key,
                extra_headers: HashMap::new(),
                is_default: false,
                api_type: Some(match provider_data.api_type {
                    super::types::ApiType::Anthropic => ApiType::Anthropic,
                    super::types::ApiType::OpenAI => ApiType::OpenAI,
                }),
                target_model,
                fuzzy_match: is_claude_code && matches!(entry.match_type, super::types::MatchType::Model),
            });
        }

        // Process default route for this Switcher
        // Priority: explicit "default" handle > main "output" handle (was "input" on the old layout)
        if switcher_data.has_default {
            let default_handle = "default";
            if let Some(edge) = source_edge_map.get(&(node.id.as_str(), default_handle)) {
                let provider = resolve_provider(&edge.target, &node_map)?;
                let provider_data: ProviderNodeData = deserialize_node_data(provider)?;

                default_route = Some(CompiledRoute {
                    id: format!("route-default-{}", node.id),
                    match_type: MatchType::PathPrefix,
                    pattern: String::new(),
                    upstream_url: normalize_base_url(&provider_data.base_url),
                    anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                    api_key: provider_data.api_key,
                    extra_headers: HashMap::new(),
                    is_default: true,
                    api_type: Some(match provider_data.api_type {
                        super::types::ApiType::Anthropic => ApiType::Anthropic,
                        super::types::ApiType::OpenAI => ApiType::OpenAI,
                    }),
                    target_model: String::new(),
                    fuzzy_match: false,
                });
            }
        }

        // If no explicit default route, check main input handle
        // The Switcher's "input" handle is a target handle (from Application),
        // not a source handle going to Provider. So we skip this for now.
    }

    // Process Application nodes directly connected to a Provider (no Switcher)
    for node in &doc.nodes {
        if node.node_type != NodeType::Application {
            continue;
        }

        // Find edges where this Application is the source
        for edge in &doc.edges {
            if edge.source != node.id {
                continue;
            }

            let target_node = node_map.get(edge.target.as_str());
            if let Some(target) = target_node {
                if target.node_type == NodeType::Provider {
                    let provider_data: ProviderNodeData = deserialize_node_data(target)?;
                    // Only set default route if not already set by a Switcher
                    if default_route.is_none() {
                        default_route = Some(CompiledRoute {
                            id: format!("route-direct-{}", node.id),
                            match_type: MatchType::PathPrefix,
                            pattern: String::new(),
                            upstream_url: normalize_base_url(&provider_data.base_url),
                            anthropic_upstream_url: provider_data.anthropic_base_url.as_deref().map(normalize_base_url),
                            api_key: provider_data.api_key,
                            extra_headers: HashMap::new(),
                            is_default: true,
                            api_type: Some(match provider_data.api_type {
                                super::types::ApiType::Anthropic => ApiType::Anthropic,
                                super::types::ApiType::OpenAI => ApiType::OpenAI,
                            }),
                            target_model: String::new(),
                            fuzzy_match: false,
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
        ApiType as DagApiType,
    };
    use crate::proxy::types::MatchType as ProxyMatchType;
    use std::collections::HashMap;

    fn default_settings() -> AppSettings {
        AppSettings {
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
            proxy_auth_token: String::new(),
        }
    }

    fn make_provider(id: &str, label: &str, api_type: DagApiType, base_url: &str, api_key: &str, models: Vec<ProviderModel>) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Provider,
            position: Position { x: 400.0, y: 0.0 },
            data: serde_json::to_value(ProviderNodeData {
                label: label.to_string(),
                description: None,
                api_type,
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

    fn make_application(id: &str, label: &str, app_type: &str) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Application,
            position: Position { x: 0.0, y: 0.0 },
            data: serde_json::to_value(ApplicationNodeData {
                label: label.to_string(),
                description: None,
                app_type: app_type.to_string(),
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
            "p1", "OpenAI", DagApiType::OpenAI,
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

        let application = make_application("a1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            make_edge("e2", "s1", "p1", Some(&format!("entry-{}", entry_id)), Some(&format!("model-{}", model_id))),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.listen_port, 9527);
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[0].pattern, "gpt-4o");
        assert_eq!(table.routes[0].upstream_url, "https://api.openai.com/v1");
        assert_eq!(table.routes[0].api_type, Some(ApiType::OpenAI));
        // target_model is resolved from the Provider model target handle ("model-m1" → "gpt-4o")
        assert_eq!(table.routes[0].target_model, "gpt-4o");
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_application_to_switcher_with_default() {
        let entry_id = "entry-1";

        let provider_a = make_provider(
            "pa", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com/v1", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let provider_b = make_provider(
            "pb", "Anthropic", DagApiType::Anthropic,
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

        let application = make_application("a1", "Claude Code", "claude_code");

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

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://api.anthropic.com/v1");
        assert_eq!(table.default_route.as_ref().unwrap().api_type, Some(ApiType::Anthropic));
    }

    #[test]
    fn test_application_direct_to_provider() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com/v1", "sk-test",
            vec![],
        );

        let application = make_application("a1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "a1", "p1", Some("output"), Some("unified")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, provider],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.unwrap().upstream_url, "https://api.openai.com/v1");
    }

    #[test]
    fn test_entry_edge_not_found() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
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

        // No edge connecting switcher entry to provider
        let doc = DAGDocument {
            nodes: vec![switcher, provider],
            edges: vec![],
            ..Default::default()
        };

        assert!(matches!(compile(&doc, &default_settings()), Err(CompileError::EntryEdgeNotFound(_))));
    }

    #[test]
    fn test_default_edge_not_found_but_optional() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com/v1", "sk-test",
            vec![],
        );

        let switcher = make_switcher("s1", vec![], true);

        // No edge connecting switcher default or input to provider
        let doc = DAGDocument {
            nodes: vec![switcher, provider],
            edges: vec![],
            ..Default::default()
        };

        // Default route is optional, should compile successfully with no default
        let table = compile(&doc, &default_settings()).unwrap();
        assert!(table.routes.is_empty());
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_multiple_providers_different_api_types() {
        let openai = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com/v1", "sk-openai",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );

        let anthropic = make_provider(
            "p2", "Anthropic", DagApiType::Anthropic,
            "https://api.anthropic.com/v1", "sk-ant-key",
            vec![ProviderModel { id: "m2".to_string(), name: "claude-sonnet-4".to_string(), enabled: true }],
        );

        let switcher = make_switcher(
            "s1",
            vec![
                SwitcherEntry {
                    id: "entry-1".to_string(),
                    label: "gpt-4o".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "gpt-4o".to_string(),
                },
                SwitcherEntry {
                    id: "entry-2".to_string(),
                    label: "claude-sonnet-4".to_string(),
                    match_type: DagMatchType::Model,
                    pattern: "claude-sonnet-4-20250514".to_string(),
                },
            ],
            false,
        );

        let application = make_application("a1", "Claude Code", "claude_code");

        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            make_edge("e2", "s1", "p1", Some("entry-entry-1"), Some("model-m1")),
            make_edge("e3", "s1", "p2", Some("entry-entry-2"), Some("model-m2")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, openai, anthropic],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert_eq!(table.routes.len(), 2);
        assert_eq!(table.routes[0].api_type, Some(ApiType::OpenAI));
        assert_eq!(table.routes[1].api_type, Some(ApiType::Anthropic));
        // target_model is resolved from Provider model target handle
        // Route 0: edge target "model-m1" → model name "gpt-4o"
        assert_eq!(table.routes[0].target_model, "gpt-4o");
        // Route 1: edge target "model-m2" → model name "claude-sonnet-4"
        assert_eq!(table.routes[1].target_model, "claude-sonnet-4");
    }

    #[test]
    fn test_switcher_main_input_from_application() {
        let provider = make_provider(
            "p1", "OpenAI", DagApiType::OpenAI,
            "https://api.openai.com/v1", "sk-test",
            vec![],
        );

        let switcher = make_switcher("s1", vec![], false); // no entries, no explicit default

        let application = make_application("a1", "Claude Code", "claude_code");

        // Connect application output to switcher input
        let edges = vec![
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            // No edges from switcher to provider (no entries, no default)
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();
        assert!(table.routes.is_empty());
        // No default route since switcher has no source handles going to provider
        assert!(table.default_route.is_none());
    }

    #[test]
    fn test_single_provider_model_match_with_default_fallback() {
        // Scenario: single Provider with both model and unified connections from Switcher.
        // - When entry pattern matches → replace model with Provider model sub-node's model
        // - When no match → forward via default route without model replacement
        let provider = make_provider(
            "p1", "SiliconFlow", DagApiType::OpenAI,
            "https://api.siliconflow.cn/v1", "sk-sf-key",
            vec![ProviderModel { id: "m1".to_string(), name: "Qwen/Qwen2.5-7B-Instruct".to_string(), enabled: true }],
        );

        let switcher = make_switcher(
            "s1",
            vec![SwitcherEntry {
                id: "entry-1".to_string(),
                label: "GLM-4.7".to_string(),
                match_type: DagMatchType::Model,
                pattern: "Pro/zai-org/GLM-4.7".to_string(),
            }],
            true, // has explicit "default" handle
        );

        let application = make_application("a1", "Claude Code", "claude_code");

        let edges = vec![
            // Application output → Switcher main input
            make_edge("e1", "a1", "s1", Some("output"), Some("input")),
            // Switcher entry source handle → Provider model target handle (for matching rule)
            make_edge("e2", "s1", "p1", Some("entry-entry-1"), Some("model-m1")),
            // Switcher default source handle → Provider unified target handle (for default/fallback)
            make_edge("e3", "s1", "p1", Some("default"), Some("unified")),
        ];

        let doc = DAGDocument {
            nodes: vec![application, switcher, provider],
            edges,
            ..Default::default()
        };

        let table = compile(&doc, &default_settings()).unwrap();

        // Specific route: model match with target_model resolved from Provider model target handle
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].match_type, ProxyMatchType::Model);
        assert_eq!(table.routes[0].pattern, "Pro/zai-org/GLM-4.7");
        assert_eq!(table.routes[0].target_model, "Qwen/Qwen2.5-7B-Instruct");
        assert_eq!(table.routes[0].upstream_url, "https://api.siliconflow.cn/v1");

        // Default route: no model replacement, forward as-is
        assert!(table.default_route.is_some());
        assert_eq!(table.default_route.as_ref().unwrap().upstream_url, "https://api.siliconflow.cn/v1");
        assert_eq!(table.default_route.as_ref().unwrap().target_model, "");
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
