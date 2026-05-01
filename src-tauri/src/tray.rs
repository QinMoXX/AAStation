use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};
use serde::Serialize;

use crate::store::AppState;

const TRAY_STOP_PROXY_DIALOG_EVENT: &str = "tray-stop-proxy-dialog";

#[derive(Clone, Serialize)]
struct TrayStopProxyDialogPayload {
    active_requests: u64,
    intent: &'static str,
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn emit_stop_proxy_dialog<R: Runtime>(
    app: &AppHandle<R>,
    active_requests: u64,
    intent: &'static str,
) {
    // Show window first so the dialog is visible
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to(
        "main",
        TRAY_STOP_PROXY_DIALOG_EVENT,
        TrayStopProxyDialogPayload {
            active_requests,
            intent,
        },
    );
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    running: bool,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示窗口", true, None::<&str>)?;
    let separator = MenuItem::with_id(app, "separator", "─", true, None::<&str>)?;
    let toggle_proxy_text = if running { "关闭代理" } else { "开启代理" };
    let toggle_proxy = MenuItem::with_id(app, "toggle_proxy", toggle_proxy_text, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Ok(Menu::with_items(
        app,
        &[&show_hide, &separator, &toggle_proxy, &quit],
    )?)
}

/// Setup system tray with menu items
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    // Build initial menu (default to proxy stopped)
    let menu = build_tray_menu(app, false)?;

    // Build tray icon
    let _tray = TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../../src/assets/aa-station-icon-light-200px.png"
        ))?)
        .menu(&menu)
        .tooltip("AAStation - API 代理")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => {
                toggle_main_window(app);
            }
            "toggle_proxy" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        // Snapshot the status under a short-lived read lock, then
                        // release it before calling start/stop.  This avoids holding
                        // the lock across async operations (which could deadlock or
                        // block concurrent reads) while still making a consistent
                        // decision.  start()/stop() internally perform their own
                        // atomic checks to prevent duplicate operations.
                        let (running, active_requests) = {
                            let proxy = state.proxy.read().await;
                            let status = proxy.get_status().await;
                            (status.running, status.active_requests)
                        }; // read lock released here

                        if running {
                            if active_requests > 0 {
                                emit_stop_proxy_dialog(&app_handle, active_requests, "stop");
                                return;
                            }
                            let _ = state.proxy.read().await.stop(false).await;
                        } else {
                            let _ = state.proxy.read().await.start().await;
                        }

                        let new_status = state.proxy.read().await.get_status().await;
                        update_tray_menu(&app_handle, new_status.running);
                    }
                });
            }
            "quit" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let (running, active_requests) = {
                            let proxy = state.proxy.read().await;
                            let status = proxy.get_status().await;
                            (status.running, status.active_requests)
                        };

                        if running && active_requests > 0 {
                            emit_stop_proxy_dialog(&app_handle, active_requests, "quit");
                            return;
                        }

                        // Force-stop proxy before exiting to release bound ports
                        // immediately (graceful stop may hang on long-lived streams).
                        if running {
                            let _ = state.proxy.read().await.stop(true).await;
                        }
                    }

                    app_handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

/// Handle window close event - minimize to tray instead of closing
pub fn on_window_close<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    // Clone the window to move into the closure
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            // Prevent window from closing
            api.prevent_close();
            // Hide the window instead
            let _ = window_clone.hide();
        }
    });
}

/// Update tray tooltip to reflect current proxy status
pub fn update_tray_menu<R: Runtime>(app: &AppHandle<R>, running: bool) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(app, running) {
            let _ = tray.set_menu(Some(menu));
        }

        // Update tooltip instead of menu for simplicity
        let tooltip = if running {
            "AAStation - 代理运行中"
        } else {
            "AAStation - 代理已停止"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
