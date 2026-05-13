use crate::proxy::message_event::ProxyMessageEvent;
use crate::store::AppState;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const FLOATING_WINDOW_LABEL: &str = "floating-monitor";

/// Create or show the floating message monitor window.
async fn create_or_show(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(FLOATING_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    // Create a new broadcast channel for proxy message events.
    // capacity 32 is enough for burst traffic during a single request cycle.
    let (tx, _rx) = tokio::sync::broadcast::channel::<ProxyMessageEvent>(32);

    let window = WebviewWindowBuilder::new(app, FLOATING_WINDOW_LABEL, WebviewUrl::App("floating.html".into()))
        .title("")
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .resizable(false)
        .inner_size(280.0, 340.0)
        .skip_taskbar(true)
        .shadow(false)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to create floating window: {}", e))?;

    // Position at the top-right corner of the primary monitor.
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let wx = ((size.width as f64 / scale) - 280.0 - 20.0) as i32;
        let wy = 60i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(wx, wy));
    }

    // Store the sender in AppState so the proxy handler can emit events.
    let state = app.state::<AppState>();
    *state.message_sender.write().await = Some(tx.clone());

    // Store in ProxyServer for HandlerState access.
    let proxy = state.proxy.read().await;
    proxy.set_message_sender(Some(tx.clone())).await;

    // Spawn a task that forwards broadcast messages to the Tauri event system.
    // The floating window listens on the Tauri event system.
    let app_handle = app.clone();
    let mut rx = tx.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app_handle.emit("proxy-message", event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });

    Ok(())
}

/// Hide the floating message monitor window and clean up the broadcast channel.
async fn close_floating(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(FLOATING_WINDOW_LABEL) {
        let _ = window.hide();
    }

    // Clear the broadcast sender so the proxy handler stops sending events.
    let state = app.state::<AppState>();
    *state.message_sender.write().await = None;

    let proxy = state.proxy.read().await;
    proxy.set_message_sender(None).await;

    Ok(())
}

/// Tauri command: show or hide the floating message monitor window.
#[tauri::command]
pub async fn toggle_floating_window(app: AppHandle, show: bool) -> Result<(), String> {
    if show {
        create_or_show(&app).await
    } else {
        close_floating(&app).await
    }
}
