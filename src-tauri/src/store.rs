#![allow(dead_code)]

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::proxy::message_event::ProxyMessageEvent;
use crate::proxy::ProxyServer;

/// Application state managed by Tauri via `app.manage()`.
/// Shared across all Tauri commands via `State<'_, AppState>`.
pub struct AppState {
    pub proxy: Arc<RwLock<ProxyServer>>,
    /// The proxy auth token for verifying client requests.
    /// Updated when settings are saved.
    pub proxy_auth_token: Arc<RwLock<String>>,
    /// Broadcast sender for proxy message events consumed by the floating window.
    /// Created when the floating window is first shown, persists across hide/show cycles.
    pub message_sender: Arc<RwLock<Option<tokio::sync::broadcast::Sender<ProxyMessageEvent>>>>,
}

impl AppState {
    pub fn new() -> Self {
        // Try to load existing settings to get the auth token
        let auth_token = crate::settings::load_settings()
            .map(|s| s.proxy_auth_token)
            .unwrap_or_else(|_| crate::settings::generate_auth_token());

        let proxy = ProxyServer::new();
        // We'll sync the auth token to the proxy server after creation
        // (async, so we can't do it here in new())

        Self {
            proxy: Arc::new(RwLock::new(proxy)),
            proxy_auth_token: Arc::new(RwLock::new(auth_token)),
            message_sender: Arc::new(RwLock::new(None)),
        }
    }

    /// Update the proxy auth token (called when settings are saved).
    pub async fn update_auth_token(&self, new_token: String) {
        let mut token = self.proxy_auth_token.write().await;
        *token = new_token;
    }
}
