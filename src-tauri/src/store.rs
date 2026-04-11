use std::sync::Arc;
use tokio::sync::RwLock;

use crate::proxy::ProxyServer;

/// Application state managed by Tauri via `app.manage()`.
/// Shared across all Tauri commands via `State<'_, AppState>`.
pub struct AppState {
    #[allow(dead_code)]
    pub proxy: Arc<RwLock<ProxyServer>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            proxy: Arc::new(RwLock::new(ProxyServer::new())),
        }
    }
}
