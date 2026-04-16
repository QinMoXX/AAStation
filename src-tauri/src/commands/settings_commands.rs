use crate::settings::AppSettings;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub async fn load_settings() -> Result<AppSettings, String> {
    crate::settings::load_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    // Persist to disk
    crate::settings::save_settings(&settings).map_err(|e| e.to_string())?;

    // Sync auth token to AppState and ProxyServer
    state.update_auth_token(settings.proxy_auth_token.clone()).await;
    let proxy = state.proxy.read().await;
    proxy.update_auth_token(settings.proxy_auth_token).await;

    Ok(())
}
