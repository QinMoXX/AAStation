#![allow(dead_code, unused_imports)]

use std::collections::HashMap;

use crate::proxy::types::{CompiledRoute, MatchType, RouteTable, RouteTableSet};
use crate::proxy::workflow::{
    PollerStrategy as WorkflowPollerStrategy, WorkflowBranch, WorkflowNode, WorkflowNodeKind,
    WorkflowPlan, WorkflowPollerNode, WorkflowPollerTarget, WorkflowProviderNode, WorkflowMatchNode,
};
use crate::settings::AppSettings;

use super::types::{
    ApplicationNodeData, DAGDocument, DAGEdge, DAGNode, NodeType, PollerNodeData,
    PollerStrategy, ProviderModel, ProviderNodeData, SwitcherNodeData,
};

const DEFAULT_PROVIDER_TOKEN_BUDGET_TOKENS: u64 = 1_000_000;

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
    let node_map: HashMap<&str, &DAGNode> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut outgoing: HashMap<&str, Vec<&DAGEdge>> = HashMap::new();
    for e in &doc.edges {
        outgoing.entry(e.source.as_str()).or_default().push(e);
    }

    let source_edge_map: HashMap<(&str, &str), &DAGEdge> = doc
        .edges
        .iter()
        .filter_map(|e| e.source_handle.as_deref().map(|h| ((e.source.as_str(), h), e)))
        .collect();

    let context = CompileContext {
        node_map: &node_map,
        outgoing: &outgoing,
        source_edge_map: &source_edge_map,
    };

    let mut tables = Vec::new();
    for app_node in &doc.nodes {
        if app_node.node_type != NodeType::Application {
            continue;
        }

        let app_data: ApplicationNodeData = deserialize_node_data(app_node)?;
        let app_edges = outgoing.get(app_node.id.as_str()).cloned().unwrap_or_default();

        let workflow = if app_edges.is_empty() {
            None
        } else {
            if app_edges.len() > 1 {
                return Err(CompileError::ApplicationFanOut(app_node.id.clone()));
            }
            let entry_edge = app_edges[0];
            let entry_is_default = context
                .node_map
                .get(entry_edge.target.as_str())
                .map(|node| node.node_type == NodeType::Provider)
                .unwrap_or(false);
            let mut nodes = Vec::new();
            let entry_node_id = compile_edge_to_workflow(
                entry_edge,
                &app_data.app_type,
                entry_is_default,
                &context,
                &mut nodes,
                &mut vec![app_node.id.clone()],
            )?;
            Some(WorkflowPlan { entry_node_id, nodes })
        };

        let (routes, default_route) = summarize_workflow_routes(workflow.as_ref());
        tables.push(RouteTable {
            app_id: app_node.id.clone(),
            app_label: app_data.label.clone(),
            listen_port: app_data.listen_port,
            listen_address: settings.listen_address.clone(),
            routes,
            default_route,
            workflow,
        });
    }

    Ok(RouteTableSet {
        listen_address: settings.listen_address.clone(),
        tables,
    })
}

struct CompileContext<'a> {
    node_map: &'a HashMap<&'a str, &'a DAGNode>,
    outgoing: &'a HashMap<&'a str, Vec<&'a DAGEdge>>,
    source_edge_map: &'a HashMap<(&'a str, &'a str), &'a DAGEdge>,
}

fn compile_edge_to_workflow(
    edge: &DAGEdge,
    app_type: &str,
    is_default: bool,
    context: &CompileContext<'_>,
    workflow_nodes: &mut Vec<WorkflowNode>,
    stack: &mut Vec<String>,
) -> Result<String, CompileError> {
    let target_node = context
        .node_map
        .get(edge.target.as_str())
        .ok_or_else(|| CompileError::EdgeToMissingNode(edge.target.clone()))?;

    if stack.contains(&target_node.id) {
        return Err(CompileError::WorkflowCycle(target_node.id.clone()));
    }

    match target_node.node_type {
        NodeType::Provider => {
            let route = compile_provider_route(edge, app_type, is_default, context)?;
            let node_id = format!("workflow-provider-{}", edge.id);
            workflow_nodes.push(WorkflowNode {
                id: node_id.clone(),
                kind: WorkflowNodeKind::Provider(WorkflowProviderNode { route }),
            });
            Ok(node_id)
        }
        NodeType::Switcher => {
            stack.push(target_node.id.clone());
            let node_id = compile_switcher_node(
                target_node,
                app_type,
                is_default,
                context,
                workflow_nodes,
                stack,
            )?;
            stack.pop();
            Ok(node_id)
        }
        NodeType::Poller => {
            stack.push(target_node.id.clone());
            let node_id = compile_poller_node(
                target_node,
                app_type,
                is_default,
                context,
                workflow_nodes,
                stack,
            )?;
            stack.pop();
            Ok(node_id)
        }
        NodeType::Application => Err(CompileError::InvalidTargetNode(target_node.id.clone())),
    }
}

fn compile_switcher_node(
    node: &DAGNode,
    app_type: &str,
    inherited_default: bool,
    context: &CompileContext<'_>,
    workflow_nodes: &mut Vec<WorkflowNode>,
    stack: &mut Vec<String>,
) -> Result<String, CompileError> {
    let switcher_data: SwitcherNodeData = deserialize_node_data(node)?;
    let mut branches = Vec::new();

    for entry in &switcher_data.entries {
        let entry_handle = format!("entry-{}", entry.id);
        let Some(edge) = context.source_edge_map.get(&(node.id.as_str(), entry_handle.as_str())) else {
            continue;
        };
        let next_node_id =
            compile_edge_to_workflow(edge, app_type, inherited_default, context, workflow_nodes, stack)?;
        branches.push(WorkflowBranch {
            id: format!("route-{}", entry.id),
            match_type: match entry.match_type {
                super::types::MatchType::PathPrefix => MatchType::PathPrefix,
                super::types::MatchType::Header => MatchType::Header,
                super::types::MatchType::Model => MatchType::Model,
            },
            pattern: entry.pattern.clone(),
            fuzzy_match: app_type == "claude_code"
                && matches!(entry.match_type, super::types::MatchType::Model),
            next_node_id,
        });
    }

    let default_next = if switcher_data.has_default {
        if let Some(edge) = context.source_edge_map.get(&(node.id.as_str(), "default")) {
            Some(compile_edge_to_workflow(
                edge,
                app_type,
                true,
                context,
                workflow_nodes,
                stack,
            )?)
        } else {
            None
        }
    } else {
        None
    };

    let node_id = format!("workflow-switcher-{}", node.id);
    workflow_nodes.push(WorkflowNode {
        id: node_id.clone(),
        kind: WorkflowNodeKind::Match(WorkflowMatchNode { branches, default_next }),
    });
    Ok(node_id)
}

fn compile_poller_node(
    node: &DAGNode,
    app_type: &str,
    inherited_default: bool,
    context: &CompileContext<'_>,
    workflow_nodes: &mut Vec<WorkflowNode>,
    stack: &mut Vec<String>,
) -> Result<String, CompileError> {
    let poller_data: PollerNodeData = deserialize_node_data(node)?;
    let mut targets = Vec::new();

    for target in &poller_data.targets {
        let handle = format!("target-{}", target.id);
        let Some(edge) = context.source_edge_map.get(&(node.id.as_str(), handle.as_str())) else {
            continue;
        };
        let next_node_id =
            compile_edge_to_workflow(edge, app_type, inherited_default, context, workflow_nodes, stack)?;
        targets.push(WorkflowPollerTarget {
            id: target.id.clone(),
            label: target.label.clone(),
            weight: target.weight.max(1),
            next_node_id,
        });
    }

    let default_next = if poller_data.has_default {
        if let Some(edge) = context.source_edge_map.get(&(node.id.as_str(), "default")) {
            Some(compile_edge_to_workflow(
                edge,
                app_type,
                true,
                context,
                workflow_nodes,
                stack,
            )?)
        } else {
            None
        }
    } else {
        None
    };

    let node_id = format!("workflow-poller-{}", node.id);
    workflow_nodes.push(WorkflowNode {
        id: node_id.clone(),
        kind: WorkflowNodeKind::Poller(WorkflowPollerNode {
            label: poller_data.label.clone(),
            strategy: map_poller_strategy(poller_data.strategy),
            failure_threshold: poller_data.failure_threshold.max(1),
            cooldown_seconds: poller_data.cooldown_seconds.max(1),
            probe_interval_seconds: poller_data.probe_interval_seconds.max(5),
            cycle_requests: poller_data.cycle_requests.max(1),
            targets,
            default_next,
        }),
    });
    Ok(node_id)
}

fn compile_provider_route(
    edge: &DAGEdge,
    app_type: &str,
    is_default: bool,
    context: &CompileContext<'_>,
) -> Result<CompiledRoute, CompileError> {
    let provider = resolve_provider(&edge.target, context.node_map)?;
    let provider_data: ProviderNodeData = deserialize_node_data(provider)?;
    let target_model = resolve_model_name(edge.target_handle.as_deref(), &provider_data.models);

    Ok(CompiledRoute {
        id: if is_default {
            format!("route-default-{}", edge.id)
        } else {
            format!("route-{}", edge.id)
        },
        match_type: MatchType::PathPrefix,
        pattern: String::new(),
        provider_id: provider.id.clone(),
        provider_label: provider_data.label.clone(),
        upstream_url: normalize_base_url(&provider_data.base_url),
        anthropic_upstream_url: provider_data
            .anthropic_base_url
            .as_deref()
            .map(normalize_base_url),
        api_key: provider_data.api_key,
        extra_headers: HashMap::new(),
        is_default,
        target_model,
        token_limit: provider_token_budget_to_tokens(provider_data.token_limit),
        fuzzy_match: app_type == "claude_code",
    })
}

fn provider_token_budget_to_tokens(token_limit_millions: Option<u64>) -> Option<u64> {
    token_limit_millions.and_then(|value| {
        if value == 0 {
            None
        } else {
            Some(value.saturating_mul(DEFAULT_PROVIDER_TOKEN_BUDGET_TOKENS))
        }
    })
}

fn summarize_workflow_routes(
    workflow: Option<&WorkflowPlan>,
) -> (Vec<CompiledRoute>, Option<CompiledRoute>) {
    let mut routes = Vec::new();
    let mut default_route = None;

    let Some(workflow) = workflow else {
        return (routes, default_route);
    };

    collect_route_summaries(
        workflow,
        &workflow.entry_node_id,
        None,
        false,
        &mut routes,
        &mut default_route,
    );

    (routes, default_route)
}

fn collect_route_summaries(
    workflow: &WorkflowPlan,
    node_id: &str,
    current_match: Option<(MatchType, String, bool)>,
    inherited_default: bool,
    routes: &mut Vec<CompiledRoute>,
    default_route: &mut Option<CompiledRoute>,
) {
    let Some(node) = workflow.nodes.iter().find(|node| node.id == node_id) else {
        return;
    };

    match &node.kind {
        WorkflowNodeKind::Provider(provider_node) => {
            let mut route = provider_node.route.clone();
            if let Some((match_type, pattern, fuzzy_match)) = current_match {
                route.match_type = match_type;
                route.pattern = pattern;
                route.fuzzy_match = fuzzy_match;
                route.is_default = false;
            } else {
                route.is_default = route.is_default || inherited_default;
            }

            if route.is_default && default_route.is_none() {
                *default_route = Some(route);
            } else {
                routes.push(route);
            }
        }
        WorkflowNodeKind::Match(match_node) => {
            for branch in &match_node.branches {
                collect_route_summaries(
                    workflow,
                    &branch.next_node_id,
                    Some((branch.match_type, branch.pattern.clone(), branch.fuzzy_match)),
                    false,
                    routes,
                    default_route,
                );
            }
            if let Some(next) = &match_node.default_next {
                collect_route_summaries(
                    workflow,
                    next,
                    None,
                    true,
                    routes,
                    default_route,
                );
            }
        }
        WorkflowNodeKind::Poller(poller_node) => {
            for target in &poller_node.targets {
                collect_route_summaries(
                    workflow,
                    &target.next_node_id,
                    current_match.clone(),
                    inherited_default,
                    routes,
                    default_route,
                );
            }
            if let Some(next) = &poller_node.default_next {
                collect_route_summaries(
                    workflow,
                    next,
                    current_match,
                    true,
                    routes,
                    default_route,
                );
            }
        }
    }

}

fn map_poller_strategy(strategy: PollerStrategy) -> WorkflowPollerStrategy {
    match strategy {
        PollerStrategy::RoundRobin => WorkflowPollerStrategy::RoundRobin,
        PollerStrategy::Weighted => WorkflowPollerStrategy::Weighted,
        PollerStrategy::NetworkStatus => WorkflowPollerStrategy::NetworkStatus,
        PollerStrategy::TokenRemaining => WorkflowPollerStrategy::TokenRemaining,
    }
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
    #[error("application node '{0}' has multiple outgoing edges, which is not supported yet")]
    ApplicationFanOut(String),
    #[error("workflow cycle detected at node '{0}'")]
    WorkflowCycle(String),
    #[error("node '{0}' cannot be used as a workflow target")]
    InvalidTargetNode(String),
    #[error("failed to deserialize data for node '{0}': {1}")]
    NodeDataDeserializeFailed(String, String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::types::{
        DAGEdge, DAGDocument, DAGNode, MatchType as DagMatchType, NodeType, Position,
        PollerNodeData, PollerStrategy, PollerTarget, ProviderModel, ProviderNodeData,
        SwitcherEntry, SwitcherNodeData, ApplicationNodeData,
    };
    use crate::proxy::types::MatchType as ProxyMatchType;
    use std::collections::HashMap;

    fn default_settings() -> AppSettings {
        AppSettings {
            listen_port_range: "9527-9537".to_string(),
            listen_address: "127.0.0.1".to_string(),
            proxy_auth_token: String::new(),
            log_dir_max_mb: 500,
            launch_at_startup: false,
            auto_check_update: true,
            auto_install_update: false,
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
                token_limit: None,
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

    fn make_poller(id: &str, strategy: PollerStrategy, targets: Vec<PollerTarget>, has_default: bool) -> DAGNode {
        DAGNode {
            id: id.to_string(),
            node_type: NodeType::Poller,
            position: Position { x: 200.0, y: 100.0 },
            data: serde_json::to_value(PollerNodeData {
                label: "Poller".to_string(),
                description: None,
                strategy,
                targets,
                has_default,
                failure_threshold: 3,
                cooldown_seconds: 30,
                probe_interval_seconds: 20,
                cycle_requests: 10,
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
        assert_eq!(table.default_route.as_ref().unwrap().target_model, "");
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
        assert_eq!(table.default_route.as_ref().unwrap().target_model, "");
    }

    #[test]
    fn test_application_direct_to_provider_model_handle_sets_target_model() {
        let provider = make_provider(
            "p1", "OpenAI",
            "https://api.openai.com/v1", "sk-test",
            vec![ProviderModel { id: "m1".to_string(), name: "openai/gpt-5.2".to_string(), enabled: true }],
        );

        let application = make_application("a1", "Listener", "listener", 9527);

        let edges = vec![
            make_edge("e1", "a1", "p1", Some("output"), Some("model-m1")),
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
        assert_eq!(
            table.default_route.as_ref().unwrap().target_model,
            "openai/gpt-5.2"
        );
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
    fn test_application_to_poller_to_poller_to_provider() {
        let provider = make_provider(
            "p1",
            "OpenAI",
            "https://api.openai.com/v1",
            "sk-test",
            vec![ProviderModel { id: "m1".to_string(), name: "gpt-4o".to_string(), enabled: true }],
        );
        let poller_a = make_poller(
            "po-a",
            PollerStrategy::RoundRobin,
            vec![PollerTarget { id: "t1".to_string(), label: "next".to_string(), enabled: true, weight: 1 }],
            false,
        );
        let poller_b = make_poller(
            "po-b",
            PollerStrategy::NetworkStatus,
            vec![PollerTarget { id: "t2".to_string(), label: "provider".to_string(), enabled: true, weight: 1 }],
            false,
        );
        let application = make_application("a1", "Listener", "listener", 9527);

        let doc = DAGDocument {
            nodes: vec![application, poller_a, poller_b, provider],
            edges: vec![
                make_edge("e1", "a1", "po-a", Some("output"), Some("input")),
                make_edge("e2", "po-a", "po-b", Some("target-t1"), Some("input")),
                make_edge("e3", "po-b", "p1", Some("target-t2"), Some("model-m1")),
            ],
            ..Default::default()
        };

        let set = compile(&doc, &default_settings()).unwrap();
        let table = &set.tables[0];
        assert!(table.workflow.is_some());
        assert_eq!(table.routes.len(), 1);
        assert_eq!(table.routes[0].provider_id, "p1");
        assert_eq!(table.routes[0].target_model, "gpt-4o");
    }


    #[test]
    fn test_empty_dag() {
        let doc = DAGDocument::default();
        let set = compile(&doc, &default_settings()).unwrap();
        assert!(set.tables.is_empty());
    }
}
