mod commands;
mod error;
mod proxy;
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
            commands::proxy_commands::start_proxy,
            commands::proxy_commands::stop_proxy,
            commands::proxy_commands::get_proxy_status,
            commands::proxy_commands::reload_routes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
