use crate::settings::AppSettings;
use crate::store::AppState;
use tauri::{AppHandle, State};

pub(crate) async fn apply_settings(
    app: &AppHandle,
    state: &AppState,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    crate::startup::set_launch_at_startup_enabled(app, settings.launch_at_startup)?;
    if let Ok(actual_enabled) = crate::startup::is_launch_at_startup_enabled(app) {
        settings.launch_at_startup = actual_enabled;
    }

    crate::settings::save_settings(&settings).map_err(|e| e.to_string())?;

    state.update_auth_token(settings.proxy_auth_token.clone()).await;
    let proxy = state.proxy.read().await;
    proxy.update_auth_token(settings.proxy_auth_token.clone()).await;

    Ok(settings)
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let mut settings = crate::settings::load_settings().map_err(|e| e.to_string())?;
    match crate::startup::is_launch_at_startup_enabled(&app) {
        Ok(enabled) => {
            if settings.launch_at_startup != enabled {
                settings.launch_at_startup = enabled;
                // Keep the persisted settings aligned with the actual system startup state.
                if let Err(err) = crate::settings::save_settings(&settings) {
                    tracing::warn!("failed to persist launch_at_startup state: {}", err);
                }
            }
        }
        Err(err) => {
            tracing::warn!("failed to query startup state: {}", err);
        }
    }
    Ok(settings)
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    apply_settings(&app, state.inner(), settings).await?;
    Ok(())
}
