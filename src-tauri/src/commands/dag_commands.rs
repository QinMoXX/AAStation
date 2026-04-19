use crate::dag::compile;
use crate::dag::validate;
use crate::dag::types::{ApplicationNodeData, DAGDocument, NodeType};
use crate::dag_store;
use crate::proxy::types::RouteTableSet;
use crate::settings;
use crate::store::AppState;
use tauri::State;

/// Load the DAG document from disk.
/// Returns a default `DAGDocument` if no file exists yet.
#[tauri::command]
pub async fn load_dag() -> Result<DAGDocument, String> {
    dag_store::load_dag().map_err(|e| e.to_string())
}

/// Save the DAG document to disk (atomic write).
#[tauri::command]
pub async fn save_dag(doc: DAGDocument) -> Result<(), String> {
    dag_store::save_dag(&doc).map_err(|e| e.to_string())
}

/// Validate the DAG document and return all validation errors.
#[tauri::command]
pub async fn validate_dag(doc: DAGDocument) -> Result<Vec<validate::ValidationError>, String> {
    Ok(validate::validate(&doc))
}

fn assign_missing_ports(
    doc: &mut DAGDocument,
    app_settings: &settings::AppSettings,
) -> Result<(), String> {
    let used_ports = settings::used_ports_from_dag(doc);
    let (port_start, port_end) = settings::parse_port_range(&app_settings.listen_port_range)?;
    let mut next_port = port_start;
    let mut assigned_ports: Vec<u16> = used_ports;

    for node in &mut doc.nodes {
        if node.node_type != NodeType::Application {
            continue;
        }
        if let Ok(mut data) = serde_json::from_value::<ApplicationNodeData>(node.data.clone()) {
            if data.listen_port == 0 {
                while assigned_ports.contains(&next_port) && next_port <= port_end {
                    next_port += 1;
                }
                if next_port > port_end {
                    return Err(format!(
                        "No available port in range {} (all ports in use)",
                        app_settings.listen_port_range
                    ));
                }
                data.listen_port = next_port;
                assigned_ports.push(next_port);
                next_port += 1;
                node.data = serde_json::to_value(&data).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

fn prepare_route_table_set(mut doc: DAGDocument) -> Result<(DAGDocument, RouteTableSet), String> {
    let errors = validate::validate(&doc);
    if !errors.is_empty() {
        let msgs: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
        return Err(format!("Validation failed:\n{}", msgs.join("\n")));
    }

    let app_settings = settings::load_settings().map_err(|e| e.to_string())?;
    assign_missing_ports(&mut doc, &app_settings)?;

    let route_table_set = compile::compile(&doc, &app_settings).map_err(|e| e.to_string())?;
    Ok((doc, route_table_set))
}

pub(crate) async fn restore_persisted_routes(state: &AppState) -> Result<bool, String> {
    let doc = dag_store::load_dag().map_err(|e| e.to_string())?;
    if doc.nodes.is_empty() {
        return Ok(false);
    }

    let (doc, route_table_set) = prepare_route_table_set(doc)?;
    if route_table_set.is_empty() {
        return Ok(false);
    }

    dag_store::save_dag(&doc).map_err(|e| e.to_string())?;

    let proxy = state.proxy.read().await;
    proxy.reload_routes(route_table_set).await;
    Ok(true)
}

/// Publish the DAG: validate → compile → hot-load route table into proxy.
/// Returns the compiled `RouteTableSet` on success.
///
/// Before compilation, auto-assigns listen ports to Application nodes
/// that don't have one (listen_port == 0).
#[tauri::command]
pub async fn publish_dag(
    state: State<'_, AppState>,
    doc: DAGDocument,
) -> Result<RouteTableSet, String> {
    let (doc, route_table_set) = prepare_route_table_set(doc)?;
    dag_store::save_dag(&doc).map_err(|e| e.to_string())?;

    let proxy = state.proxy.read().await;
    proxy.reload_routes(route_table_set.clone()).await;

    Ok(route_table_set)
}

/// Find the next available port from the settings port range for a new Application node.
/// Takes into account ports already used by existing Application nodes in the DAG.
#[tauri::command]
pub async fn allocate_port(doc: DAGDocument) -> Result<u16, String> {
    let app_settings = settings::load_settings().map_err(|e| e.to_string())?;
    let used_ports = settings::used_ports_from_dag(&doc);
    settings::find_available_port(&app_settings.listen_port_range, &used_ports)
        .map_err(|e| e.to_string())
}

/// Auto-assign ports to Application nodes that don't have one (listen_port == 0).
/// Returns the updated DAG document with ports assigned.
#[tauri::command]
pub async fn auto_assign_ports(mut doc: DAGDocument) -> Result<DAGDocument, String> {
    let app_settings = settings::load_settings().map_err(|e| e.to_string())?;
    assign_missing_ports(&mut doc, &app_settings)?;
    Ok(doc)
}
