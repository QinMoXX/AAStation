mod claude_config;
mod config_export;
mod codex_config;
mod commands;
mod dag;
mod dag_store;
mod error;
mod logger;
mod opencode_config;
mod proxy;
mod settings;
mod startup;
mod store;
mod tray;

use std::sync::Arc;
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
    // Read persisted settings so we can apply the user-configured log size cap
    // before the logger creates its first file. Fall back to the default if the
    // file doesn't exist or can't be parsed yet.
    let log_max_bytes = crate::settings::load_settings()
        .map(|s| s.log_dir_max_mb.max(1) * 1024 * 1024)
        .unwrap_or(logger::LOG_DIR_DEFAULT_MAX_BYTES);

    // Initialize logging (console + file). Guard must be kept alive for the
    // entire application lifetime so that buffered log entries are flushed on
    // exit — even during panics or abrupt termination.
    let _log_guard: Option<LogGuard> = match logger::init(log_max_bytes) {
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

    // Shutdown notifier shared between the setup() closure and the run() event
    // callback. Using Arc<Notify> instead of a oneshot channel avoids the need
    // for a Mutex around the Sender half.
    let shutdown = Arc::new(tokio::sync::Notify::new());
    let shutdown_for_run = shutdown.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            commands::proxy_commands::get_proxy_metrics,
            commands::proxy_commands::reload_routes,
            commands::settings_commands::load_settings,
            commands::settings_commands::save_settings,
            commands::log_commands::get_log_runtime_status,
            commands::log_commands::poll_runtime_logs,
            commands::log_commands::open_log_dir,
            commands::app_commands::configure_claude_code,
            commands::app_commands::is_claude_configured,
            commands::app_commands::unconfigure_claude_code,
            commands::app_commands::restore_claude_config,
            commands::app_commands::configure_open_code,
            commands::app_commands::is_open_code_configured,
            commands::app_commands::unconfigure_open_code,
            commands::app_commands::restore_open_code_config,
            commands::app_commands::configure_codex_cli,
            commands::app_commands::is_codex_cli_configured,
            commands::app_commands::unconfigure_codex_cli,
            commands::app_commands::restore_codex_cli_config,
            commands::config_commands::export_config_archive,
        ])
        .setup(move |app| {
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

            // Start background task to update tray status periodically.
            // `shutdown` is moved here via the `move` setup closure; the task
            // then re-captures it. `shutdown_for_run` (a clone created above)
            // is used in the run() callback to signal exit.
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            let proxy = state.proxy.clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                // Track the last known running state to avoid rebuilding the tray
                // menu when nothing has changed. Rebuilding while the context menu
                // is open causes Windows to dismiss it immediately, leaving a small
                // blank artifact on screen.
                let mut last_running: Option<bool> = None;
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let proxy = proxy.read().await;
                            let status = proxy.get_status().await;
                            drop(proxy);
                            // Only update when the state actually changes.
                            if last_running != Some(status.running) {
                                tray::update_tray_menu(&app_handle, status.running);
                                last_running = Some(status.running);
                            }
                        }
                        _ = shutdown.notified() => {
                            tracing::debug!("Tray status task received shutdown signal, exiting.");
                            break;
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // Signal the tray polling task to exit cleanly before the Tokio
            // runtime is dropped, so it doesn't get forcibly cancelled mid-tick.
            if let tauri::RunEvent::Exit = event {
                shutdown_for_run.notify_one();
            }
        });
}
