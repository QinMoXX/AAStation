mod claude_config;
mod commands;
mod dag;
mod dag_store;
mod error;
mod logger;
mod proxy;
mod settings;
mod store;
mod tray;

use std::time::Duration;
use logger::LogGuard;
use store::AppState;
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging (console + file). Guard must be kept alive for the
    // entire application lifetime so that buffered log entries are flushed on
    // exit — even during panics or abrupt termination.
    let _log_guard: Option<LogGuard> = match logger::init() {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("Failed to initialize logger: {}. Falling back to console-only.", e);
            // Fallback: console-only logging
            tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer())
                .with(tracing_subscriber::EnvFilter::from_default_env())
                .init();
            None
        }
    };

    let state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::dag_commands::load_dag,
            commands::dag_commands::save_dag,
            commands::dag_commands::validate_dag,
            commands::dag_commands::publish_dag,
            commands::dag_commands::allocate_port,
            commands::dag_commands::auto_assign_ports,
            commands::proxy_commands::start_proxy,
            commands::proxy_commands::stop_proxy,
            commands::proxy_commands::get_proxy_status,
            commands::proxy_commands::reload_routes,
            commands::settings_commands::load_settings,
            commands::settings_commands::save_settings,
            commands::app_commands::configure_claude_code,
            commands::app_commands::unconfigure_claude_code,
            commands::app_commands::restore_claude_config,
        ])
        .setup(|app| {
            // Setup system tray
            tray::setup_tray(app.handle()).map_err(|e| e.to_string())?;

            // Setup window close handler - minimize to tray instead of closing
            if let Some(window) = app.get_webview_window("main") {
                tray::on_window_close(&window);
            }

            // Sync proxy auth token from AppState to ProxyServer at startup
            let state = app.state::<AppState>();
            let auth_token = state.proxy_auth_token.blocking_read().clone();
            {
                let proxy = state.proxy.blocking_read();
                *proxy.proxy_auth_token.blocking_write() = auth_token;
            }

            // Start background task to update tray status periodically
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            let proxy = state.proxy.clone();
            
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                loop {
                    interval.tick().await;
                    let proxy = proxy.read().await;
                    let status = proxy.get_status().await;
                    drop(proxy);
                    tray::update_tray_menu(&app_handle, status.running);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
