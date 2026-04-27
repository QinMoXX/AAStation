use crate::commands::dag_commands;
use crate::proxy::types::{ProxyMetricsSnapshot, ProxyStatus, RouteTableSet};
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub async fn start_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let needs_restore = {
        let proxy = state.proxy.read().await;
        let tables_by_port = proxy.state.route_tables_by_port.read().await;
        tables_by_port.is_empty()
    };

    if needs_restore {
        let _ = dag_commands::restore_persisted_routes(state.inner()).await?;
    }

    let proxy = state.proxy.read().await;
    proxy.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, AppState>, force: Option<bool>) -> Result<(), String> {
    let proxy = state.proxy.read().await;
    proxy.stop(force.unwrap_or(false)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_proxy_status(state: State<'_, AppState>) -> Result<ProxyStatus, String> {
    let proxy = state.proxy.read().await;
    Ok(proxy.get_status().await)
}

#[tauri::command]
pub async fn get_proxy_metrics(state: State<'_, AppState>) -> Result<ProxyMetricsSnapshot, String> {
    let proxy = state.proxy.read().await;
    Ok(proxy.get_metrics_snapshot().await)
}

#[tauri::command]
pub async fn reload_routes(state: State<'_, AppState>, table_set: RouteTableSet) -> Result<(), String> {
    let proxy = state.proxy.read().await;
    proxy.reload_routes(table_set).await;
    Ok(())
}
