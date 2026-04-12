use crate::dag::compile;
use crate::dag::validate;
use crate::dag::types::DAGDocument;
use crate::dag_store;
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

/// Publish the DAG: validate → compile → hot-load route table into proxy.
/// Returns the compiled `RouteTable` on success.
#[tauri::command]
pub async fn publish_dag(
    state: State<'_, AppState>,
    doc: DAGDocument,
) -> Result<crate::proxy::types::RouteTable, String> {
    // 1. Validate
    let errors = validate::validate(&doc);
    if !errors.is_empty() {
        let msgs: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
        return Err(format!("Validation failed:\n{}", msgs.join("\n")));
    }

    // 2. Load settings for listen port/address
    let app_settings = settings::load_settings().map_err(|e| e.to_string())?;

    // 3. Compile with settings
    let route_table = compile::compile(&doc, &app_settings).map_err(|e| e.to_string())?;

    // 4. Hot-load into proxy
    let proxy = state.proxy.read().await;
    proxy.reload_routes(route_table.clone()).await;

    Ok(route_table)
}
