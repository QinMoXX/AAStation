#![allow(dead_code)]

use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;

use super::error::ProxyError;
use super::metrics::MetricsStore;
use super::handler::proxy_handler;
use super::types::{ProxyConfig, ProxyStatus, RouteTable, RouteTableSet};

/// A single running listener — one per Application node.
pub(crate) struct RunningListener {
    pub port: u16,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
    pub server_handle: Option<JoinHandle<()>>,
    pub request_counter: Arc<std::sync::atomic::AtomicU64>,
    pub start_time: Instant,
}

/// Internal state of the running proxy server.
pub struct ProxyState {
    /// Route tables indexed by port number.
    pub route_tables_by_port: Arc<RwLock<HashMap<u16, Arc<RwLock<RouteTable>>>>>,
    pub status: Arc<RwLock<ProxyStatus>>,
    pub request_counter: Arc<std::sync::atomic::AtomicU64>,
    pub start_time: Arc<RwLock<Option<Instant>>>,
    pub metrics: MetricsStore,
    /// Running listeners, keyed by port.
    pub listeners: Arc<RwLock<HashMap<u16, RunningListener>>>,
    pub config: Arc<RwLock<ProxyConfig>>,
}

/// Manages the axum proxy server lifecycle and holds runtime state.
/// Supports multiple listeners, one per Application node.
pub struct ProxyServer {
    pub state: ProxyState,
    /// Proxy auth token — shared with HandlerState for request verification.
    pub proxy_auth_token: Arc<RwLock<String>>,
}

/// Shared state injected into each axum handler via extension.
/// Cheaply cloneable (all inner fields are Arc).
#[derive(Clone)]
pub struct HandlerState {
    pub route_table: Arc<RwLock<RouteTable>>,
    pub request_counter: Arc<std::sync::atomic::AtomicU64>,
    pub listen_port: u16,
    pub metrics: MetricsStore,
    pub http_client: reqwest::Client,
    /// Auth token for verifying client requests.
    /// Updated when settings are saved (via ProxyServer::update_auth_token).
    pub proxy_auth_token: Arc<RwLock<String>>,
}

use std::collections::HashMap;

impl ProxyServer {
    pub fn new() -> Self {
        Self {
            state: ProxyState {
                route_tables_by_port: Arc::new(RwLock::new(HashMap::new())),
                status: Arc::new(RwLock::new(ProxyStatus::default())),
                request_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                start_time: Arc::new(RwLock::new(None)),
                metrics: MetricsStore::new(),
                listeners: Arc::new(RwLock::new(HashMap::new())),
                config: Arc::new(RwLock::new(ProxyConfig::default())),
            },
            proxy_auth_token: Arc::new(RwLock::new(String::new())),
        }
    }

    /// Update the proxy auth token (called when settings are saved).
    pub async fn update_auth_token(&self, new_token: String) {
        let mut token = self.proxy_auth_token.write().await;
        *token = new_token;
    }

    /// Start proxy listeners for all Application nodes.
    /// Binds one port per Application and begins accepting connections.
    pub async fn start(&self) -> Result<(), ProxyError> {
        // Guard: already running?
        if self.is_running().await {
            let port = self.state.status.read().await.port;
            return Err(ProxyError::AlreadyRunning(port));
        }

        let tables_by_port = self.state.route_tables_by_port.read().await;
        if tables_by_port.is_empty() {
            return Err(ProxyError::NoRouteTable);
        }

        let config = self.state.config.read().await;
        let mut listeners = self.state.listeners.write().await;
        let mut first_port: u16 = 0;

        for (port, route_table) in tables_by_port.iter() {
            let table = route_table.read().await;
            if table.is_empty() {
                continue;
            }

            let addr = format!("{}:{}", config.listen_address, port);
            let listener = tokio::net::TcpListener::bind(&addr)
                .await
                .map_err(|e| ProxyError::BindFailed(addr.clone(), e.to_string()))?;
            let local_addr = listener.local_addr().unwrap();

            if first_port == 0 {
                first_port = local_addr.port();
            }

            // One-shot shutdown channel
            let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

            let app_request_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));

            // Handler state (shared across all request tasks for this listener)
            let handler_state = HandlerState {
                route_table: Arc::clone(route_table),
                request_counter: Arc::clone(&app_request_counter),
                listen_port: *port,
                metrics: self.state.metrics.clone(),
                http_client: reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(300))
                    .build()
                    .unwrap_or_else(|_| reqwest::Client::new()),
                proxy_auth_token: Arc::clone(&self.proxy_auth_token),
            };

            // Build axum router with catch-all handler
            let app = axum::Router::new()
                .fallback(axum::routing::any(proxy_handler))
                .layer(axum::extract::DefaultBodyLimit::max(200 * 1024 * 1024)) // 200 MB
                .layer(tower_http::cors::CorsLayer::permissive())
                .with_state(handler_state);

            // Spawn server task
            let handle = tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async {
                        let _ = shutdown_rx.await;
                    })
                    .await
                    .ok();
            });

            listeners.insert(*port, RunningListener {
                port: local_addr.port(),
                shutdown_tx: Some(shutdown_tx),
                server_handle: Some(handle),
                request_counter: app_request_counter,
                start_time: Instant::now(),
            });
        }

        drop(tables_by_port);
        drop(config);

        // Update global status
        let mut status = self.state.status.write().await;
        status.running = true;
        status.port = first_port;
        drop(status);

        *self.state.start_time.write().await = Some(Instant::now());

        Ok(())
    }

    /// Stop all proxy listeners gracefully.
    pub async fn stop(&self) -> Result<(), ProxyError> {
        if !self.is_running().await {
            return Err(ProxyError::NotRunning);
        }

        let mut listeners = self.state.listeners.write().await;

        // Send shutdown signals and wait for all servers
        for (_, listener) in listeners.iter_mut() {
            if let Some(tx) = listener.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }

        for (_, listener) in listeners.iter_mut() {
            if let Some(handle) = listener.server_handle.take() {
                let _ = handle.await;
            }
        }

        listeners.clear();

        // Reset status
        let mut status = self.state.status.write().await;
        status.running = false;
        status.port = 0;
        drop(status);

        *self.state.start_time.write().await = None;

        Ok(())
    }

    /// Hot-reload the route table set: atomic swap for each port, in-flight requests are not interrupted.
    /// Also syncs listen_address from the route table set into ProxyConfig.
    pub async fn reload_routes(&self, new_set: RouteTableSet) {
        // Sync config
        {
            let mut config = self.state.config.write().await;
            config.listen_address = new_set.listen_address.clone();
        }

        let mut tables_by_port = self.state.route_tables_by_port.write().await;
        tables_by_port.clear();

        let mut total_routes = 0;

        for table in new_set.tables {
            if table.is_empty() {
                continue;
            }
            total_routes += table.routes.len();
            tables_by_port.insert(table.listen_port, Arc::new(RwLock::new(table)));
        }

        let mut status = self.state.status.write().await;
        status.active_routes = total_routes;
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

        // Sum up request counts from all listeners
        let total_requests: u64 = self.state.listeners.read().await
            .values()
            .map(|l| l.request_counter.load(std::sync::atomic::Ordering::Relaxed))
            .sum();

        ProxyStatus {
            running: status.running,
            port: status.port,
            listen_ports: self.listen_ports().await,
            published_at: status.published_at.clone(),
            active_routes: status.active_routes,
            total_requests,
            uptime_seconds: uptime,
        }
    }

    /// Get the list of ports currently being listened on.
    pub async fn listen_ports(&self) -> Vec<u16> {
        let listeners = self.state.listeners.read().await;
        let mut ports: Vec<u16> = listeners.keys().copied().collect();
        ports.sort();
        ports
    }

    /// Get a monitoring snapshot of all requests seen since app start.
    pub async fn get_metrics_snapshot(&self) -> super::types::ProxyMetricsSnapshot {
        self.state.metrics.snapshot().await
    }
}
