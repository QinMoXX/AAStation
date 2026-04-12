mod commands;
mod dag;
mod dag_store;
mod error;
mod proxy;
mod settings;
mod store;

use store::AppState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::dag_commands::load_dag,
            commands::dag_commands::save_dag,
            commands::dag_commands::validate_dag,
            commands::dag_commands::publish_dag,
            commands::proxy_commands::start_proxy,
            commands::proxy_commands::stop_proxy,
            commands::proxy_commands::get_proxy_status,
            commands::proxy_commands::reload_routes,
            commands::settings_commands::load_settings,
            commands::settings_commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
