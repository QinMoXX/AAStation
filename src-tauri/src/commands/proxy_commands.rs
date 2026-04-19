use crate::proxy::types::{ProxyStatus, RouteTableSet};
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub async fn start_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let proxy = state.proxy.read().await;
    proxy.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let proxy = state.proxy.read().await;
    proxy.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_proxy_status(state: State<'_, AppState>) -> Result<ProxyStatus, String> {
    let proxy = state.proxy.read().await;
    Ok(proxy.get_status().await)
}

#[tauri::command]
pub async fn reload_routes(state: State<'_, AppState>, table_set: RouteTableSet) -> Result<(), String> {
    let proxy = state.proxy.read().await;
    proxy.reload_routes(table_set).await;
    Ok(())
}
