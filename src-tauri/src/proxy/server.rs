#![allow(dead_code)]

use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;

use super::error::ProxyError;
use super::handler::proxy_handler;
use super::types::{ProxyConfig, ProxyStatus, RouteTable};

/// Internal state of the running proxy server.
pub struct ProxyState {
    pub route_table: Arc<RwLock<RouteTable>>,
    pub status: Arc<RwLock<ProxyStatus>>,
    pub request_counter: Arc<std::sync::atomic::AtomicU64>,
    pub start_time: Arc<RwLock<Option<Instant>>>,
    pub shutdown_tx: Arc<RwLock<Option<oneshot::Sender<()>>>>,
    pub server_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
}

/// Manages the axum proxy server lifecycle and holds runtime state.
pub struct ProxyServer {
    pub state: ProxyState,
    pub config: Arc<RwLock<ProxyConfig>>,
}

/// Shared state injected into each axum handler via extension.
/// Cheaply cloneable (all inner fields are Arc).
#[derive(Clone)]
pub struct HandlerState {
    pub route_table: Arc<RwLock<RouteTable>>,
    pub request_counter: Arc<std::sync::atomic::AtomicU64>,
    pub http_client: reqwest::Client,
}

impl ProxyServer {
    pub fn new() -> Self {
        Self {
            state: ProxyState {
                route_table: Arc::new(RwLock::new(RouteTable::default())),
                status: Arc::new(RwLock::new(ProxyStatus::default())),
                request_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                start_time: Arc::new(RwLock::new(None)),
                shutdown_tx: Arc::new(RwLock::new(None)),
                server_handle: Arc::new(RwLock::new(None)),
            },
            config: Arc::new(RwLock::new(ProxyConfig::default())),
        }
    }

    /// Start the axum proxy server.
    /// Binds to the configured address/port and begins accepting connections.
    pub async fn start(&self) -> Result<(), ProxyError> {
        // Guard: already running?
        if self.is_running().await {
            let port = self.state.status.read().await.port;
            return Err(ProxyError::AlreadyRunning(port));
        }

        // Guard: must have a non-empty route table
        if self.state.route_table.read().await.is_empty() {
            return Err(ProxyError::NoRouteTable);
        }

        let config = self.config.read().await;
        let addr = format!("{}:{}", config.listen_address, config.listen_port);
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| ProxyError::BindFailed(addr.clone(), e.to_string()))?;
        let local_addr = listener.local_addr().unwrap();

        // One-shot shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        *self.state.shutdown_tx.write().await = Some(shutdown_tx);

        // Handler state (shared across all request tasks)
        let handler_state = HandlerState {
            route_table: Arc::clone(&self.state.route_table),
            request_counter: Arc::clone(&self.state.request_counter),
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        };

        // Build axum router with catch-all handler
        let app = axum::Router::new()
            .fallback(axum::routing::any(proxy_handler))
            .layer(axum::extract::DefaultBodyLimit::max(200 * 1024 * 1024)) // 200 MB
            .layer(tower_http::cors::CorsLayer::permissive())
            .with_state(handler_state);

        // Update status
        let mut status = self.state.status.write().await;
        status.running = true;
        status.port = local_addr.port();
        drop(status);

        *self.state.start_time.write().await = Some(Instant::now());

        // Spawn server task
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        *self.state.server_handle.write().await = Some(handle);

        Ok(())
    }

    /// Stop the proxy server gracefully.
    /// Sends the shutdown signal and waits for the server task to finish.
    pub async fn stop(&self) -> Result<(), ProxyError> {
        if !self.is_running().await {
            return Err(ProxyError::NotRunning);
        }

        // Send shutdown signal
        if let Some(tx) = self.state.shutdown_tx.write().await.take() {
            let _ = tx.send(());
        }

        // Wait for server task to finish
        if let Some(handle) = self.state.server_handle.write().await.take() {
            let _ = handle.await;
        }

        // Reset status
        let mut status = self.state.status.write().await;
        status.running = false;
        status.port = 0;
        drop(status);

        *self.state.start_time.write().await = None;

        Ok(())
    }

    /// Hot-reload the route table: atomic swap, in-flight requests are not interrupted.
    /// Also syncs listen_port/listen_address from the route table into ProxyConfig
    /// so that start() binds to the correct address.
    pub async fn reload_routes(&self, new_table: RouteTable) {
        let route_count = new_table.routes.len();

        // Sync config from route table
        {
            let mut config = self.config.write().await;
            config.listen_port = new_table.listen_port;
            config.listen_address = new_table.listen_address.clone();
        }

        *self.state.route_table.write().await = new_table;
        let mut status = self.state.status.write().await;
        status.active_routes = route_count;
    }

    /// Check if the proxy is currently running.
    pub async fn is_running(&self) -> bool {
        self.state.status.read().await.running
    }

    /// Get a snapshot of the current proxy status.
    pub async fn get_status(&self) -> ProxyStatus {
        let status = self.state.status.read().await;
        let uptime = if let Some(start) = *self.state.start_time.read().await {
            start.elapsed().as_secs()
        } else {
            0
        };
        ProxyStatus {
            running: status.running,
            port: status.port,
            published_at: status.published_at.clone(),
            active_routes: status.active_routes,
            total_requests: self
                .state
                .request_counter
                .load(std::sync::atomic::Ordering::Relaxed),
            uptime_seconds: uptime,
        }
    }
}
