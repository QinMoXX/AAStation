#![allow(dead_code)]

use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;
use std::collections::{HashMap, HashSet};
use tokio::time::MissedTickBehavior;

use super::error::ProxyError;
use super::health::{probe_interval, PollerRuntimeStore, ProviderRuntimeStore};
use super::metrics::MetricsStore;
use super::handler::proxy_handler;
use super::types::{CompiledRoute, ProxyConfig, ProxyStatus, RouteTable, RouteTableSet};
use super::workflow::ensure_route_table_workflow;

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
    pub poller_cursors: Arc<RwLock<HashMap<String, usize>>>,
    pub provider_runtime: ProviderRuntimeStore,
    pub poller_runtime: PollerRuntimeStore,
    pub health_probe_shutdown: Arc<RwLock<Option<oneshot::Sender<()>>>>,
    pub health_probe_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
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
    pub poller_cursors: Arc<RwLock<HashMap<String, usize>>>,
    pub provider_runtime: ProviderRuntimeStore,
    pub poller_runtime: PollerRuntimeStore,
    /// Auth token for verifying client requests.
    /// Updated when settings are saved (via ProxyServer::update_auth_token).
    pub proxy_auth_token: Arc<RwLock<String>>,
}

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
                poller_cursors: Arc::new(RwLock::new(HashMap::new())),
                provider_runtime: ProviderRuntimeStore::new(),
                poller_runtime: PollerRuntimeStore::new(),
                health_probe_shutdown: Arc::new(RwLock::new(None)),
                health_probe_handle: Arc::new(RwLock::new(None)),
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
                poller_cursors: Arc::clone(&self.state.poller_cursors),
                provider_runtime: self.state.provider_runtime.clone(),
                poller_runtime: self.state.poller_runtime.clone(),
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
        self.start_health_probe_loop().await;

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

        if let Some(tx) = self.state.health_probe_shutdown.write().await.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.state.health_probe_handle.write().await.take() {
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

    /// Hot-reload the route table set: atomic swap for each port, in-flight requests are not interrupted.
    /// Also syncs listen_address from the route table set into ProxyConfig.
    pub async fn reload_routes(&self, new_set: RouteTableSet) {
        let published_at = chrono::Utc::now().to_rfc3339();

        // Sync config
        {
            let mut config = self.state.config.write().await;
            config.listen_address = new_set.listen_address.clone();
        }

        let mut updates: Vec<(Arc<RwLock<RouteTable>>, RouteTable)> = Vec::new();
        let mut desired_ports: HashSet<u16> = HashSet::new();
        let mut total_routes = 0;
        let mut active_provider_ids = Vec::new();

        let mut tables_by_port = self.state.route_tables_by_port.write().await;
        for mut table in new_set.tables {
            ensure_route_table_workflow(&mut table);
            if table.is_empty() {
                continue;
            }
            desired_ports.insert(table.listen_port);
            total_routes += table.routes.len();
            for route in &table.routes {
                self.state
                    .provider_runtime
                    .observe_provider(
                        &route.provider_id,
                        &route.provider_label,
                        route.token_limit.unwrap_or(0),
                    )
                    .await;
                active_provider_ids.push(route.provider_id.clone());
            }
            if let Some(route) = &table.default_route {
                self.state
                    .provider_runtime
                    .observe_provider(
                        &route.provider_id,
                        &route.provider_label,
                        route.token_limit.unwrap_or(0),
                    )
                    .await;
                active_provider_ids.push(route.provider_id.clone());
            }

            if let Some(existing_table) = tables_by_port.get(&table.listen_port) {
                // Keep the same Arc so running listeners immediately observe new routes.
                updates.push((Arc::clone(existing_table), table));
            } else {
                tables_by_port.insert(table.listen_port, Arc::new(RwLock::new(table)));
            }
        }

        // Remove route tables for ports that are no longer published.
        // Existing listeners on these ports are not restarted here; they should be
        // managed by start/stop lifecycle. Removing from the map keeps runtime state
        // aligned with the latest published DAG.
        let stale_ports: Vec<u16> = tables_by_port
            .keys()
            .copied()
            .filter(|port| !desired_ports.contains(port))
            .collect();
        for port in stale_ports {
            tables_by_port.remove(&port);
        }
        drop(tables_by_port);
        self.state.provider_runtime.retain_only(&active_provider_ids).await;

        for (table_ref, new_table) in updates {
            let mut current = table_ref.write().await;
            *current = new_table;
        }

        let mut status = self.state.status.write().await;
        status.active_routes = total_routes;
        status.published_at = Some(published_at);
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
        self.state
            .metrics
            .snapshot(
                self.state.provider_runtime.snapshot().await,
                self.state.poller_runtime.snapshot().await,
            )
            .await
    }

    async fn start_health_probe_loop(&self) {
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        *self.state.health_probe_shutdown.write().await = Some(shutdown_tx);

        let route_tables_by_port = Arc::clone(&self.state.route_tables_by_port);
        let provider_runtime = self.state.provider_runtime.clone();
        let metrics = self.state.metrics.clone();
        let handle = tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(3))
                .timeout(std::time::Duration::from_secs(8))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());
            let mut ticker = tokio::time::interval(probe_interval());
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    _ = ticker.tick() => {
                        run_health_probe_cycle(&route_tables_by_port, &provider_runtime, &metrics, &client).await;
                    }
                }
            }
        });
        *self.state.health_probe_handle.write().await = Some(handle);
    }
}

async fn run_health_probe_cycle(
    route_tables_by_port: &Arc<RwLock<HashMap<u16, Arc<RwLock<RouteTable>>>>>,
    provider_runtime: &ProviderRuntimeStore,
    metrics: &MetricsStore,
    client: &reqwest::Client,
) {
    let provider_routes = collect_provider_routes(route_tables_by_port).await;
    for route in provider_routes {
        let used_tokens = metrics
            .provider_summary(&route.provider_id)
            .await
            .map(|summary| summary.summary.total_tokens)
            .unwrap_or(0);
        let budget_tokens = route.token_limit.unwrap_or(0);
        if let Some(runtime_state) = provider_runtime.get(&route.provider_id).await {
            let interval = runtime_state.probe_interval_seconds.max(5);
            let should_probe = runtime_state
                .last_probe_at
                .as_deref()
                .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
                .map(|time| {
                    chrono::Utc::now()
                        .signed_duration_since(time.with_timezone(&chrono::Utc))
                        .num_seconds()
                        >= interval as i64
                })
                .unwrap_or(true);
            if !should_probe {
                continue;
            }
        }

        let probe_result = client.head(&route.upstream_url).send().await;
        let reachable = probe_result.is_ok();
        let error = probe_result.err().map(|err| err.to_string());

        provider_runtime
            .record_probe_result(
                &route.provider_id,
                &route.provider_label,
                budget_tokens,
                used_tokens,
                reachable,
                error,
            )
            .await;
    }
}

async fn collect_provider_routes(
    route_tables_by_port: &Arc<RwLock<HashMap<u16, Arc<RwLock<RouteTable>>>>>,
) -> Vec<CompiledRoute> {
    let tables: Vec<Arc<RwLock<RouteTable>>> = route_tables_by_port
        .read()
        .await
        .values()
        .cloned()
        .collect();
    let mut providers = HashMap::<String, CompiledRoute>::new();

    for table in tables {
        let table = table.read().await;
        for route in &table.routes {
            providers
                .entry(route.provider_id.clone())
                .or_insert_with(|| route.clone());
        }
        if let Some(route) = &table.default_route {
            providers
                .entry(route.provider_id.clone())
                .or_insert_with(|| route.clone());
        }
    }

    providers.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proxy::types::{CompiledRoute, MatchType, RouteTable, RouteTableSet};

    fn make_route(route_id: &str, provider_label: &str) -> CompiledRoute {
        CompiledRoute {
            id: route_id.to_string(),
            match_type: MatchType::PathPrefix,
            pattern: "/v1/messages".to_string(),
            provider_id: "provider-1".to_string(),
            provider_label: provider_label.to_string(),
            upstream_url: "https://upstream.example.com".to_string(),
            anthropic_upstream_url: None,
            api_key: "test-key".to_string(),
            extra_headers: HashMap::new(),
            is_default: false,
            target_model: String::new(),
            token_limit: None,
            fuzzy_match: false,
        }
    }

    fn make_table(route_id: &str, provider_label: &str, port: u16) -> RouteTable {
        RouteTable {
            app_id: "app-1".to_string(),
            app_label: "App 1".to_string(),
            listen_port: port,
            listen_address: "127.0.0.1".to_string(),
            routes: vec![make_route(route_id, provider_label)],
            default_route: None,
            workflow: None,
        }
    }

    #[tokio::test]
    async fn reload_routes_updates_existing_table_in_place() {
        let server = ProxyServer::new();
        let port = 9527;

        server
            .reload_routes(RouteTableSet {
                listen_address: "127.0.0.1".to_string(),
                tables: vec![make_table("old-route", "Old Provider", port)],
            })
            .await;

        let original_table_ref = {
            let tables = server.state.route_tables_by_port.read().await;
            tables.get(&port).cloned().expect("route table should exist")
        };

        server
            .reload_routes(RouteTableSet {
                listen_address: "127.0.0.1".to_string(),
                tables: vec![make_table("new-route", "New Provider", port)],
            })
            .await;

        let current_table_ref = {
            let tables = server.state.route_tables_by_port.read().await;
            tables.get(&port).cloned().expect("route table should exist")
        };

        assert!(Arc::ptr_eq(&original_table_ref, &current_table_ref));

        let table = original_table_ref.read().await;
        assert_eq!(table.routes[0].id, "new-route");
        assert_eq!(table.routes[0].provider_label, "New Provider");
    }

    #[tokio::test]
    async fn metrics_snapshot_includes_runtime_status() {
        let server = ProxyServer::new();
        let port = 9527;

        server
            .reload_routes(RouteTableSet {
                listen_address: "127.0.0.1".to_string(),
                tables: vec![make_table("route-1", "Provider A", port)],
            })
            .await;

        server
            .state
            .poller_runtime
            .record_selection(
                "poller-1",
                "Poller 1",
                super::super::types::PollerStrategyRuntime::Weighted,
                1,
                3,
                30,
                20,
                &[("target-a".to_string(), "目标 A".to_string(), 1)],
                "target-a",
                "目标 A",
                1,
                "provider-1",
                "Provider A",
            )
            .await;

        let snapshot = server.get_metrics_snapshot().await;
        assert_eq!(snapshot.provider_runtime.len(), 1);
        assert_eq!(snapshot.provider_runtime[0].provider_id, "provider-1");
        assert_eq!(snapshot.poller_runtime.len(), 1);
        assert_eq!(snapshot.poller_runtime[0].poller_id, "poller-1");
    }
}
