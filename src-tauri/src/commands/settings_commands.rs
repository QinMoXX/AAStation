use crate::settings::AppSettings;

#[tauri::command]
pub async fn load_settings() -> Result<AppSettings, String> {
    crate::settings::load_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    crate::settings::save_settings(&settings).map_err(|e| e.to_string())
}
