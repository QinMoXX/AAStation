#![allow(dead_code, unused_imports)]

use std::time::Instant;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use tokio::sync::oneshot;

use super::body_parser::{detect_request_protocol, extract_model};
use super::error::ProxyError;
use super::forwarder::forward_request;
use super::server::HandlerState;
use super::sse_patch::AnthropicSsePatchStream;
use super::stream::{is_sse_response, LoggedStream, MeteredStream};
use super::types::{ProxyRequestMetric, RequestProtocol};
use super::workflow::{execute_workflow, WorkflowRuntime};

#[derive(Clone)]
struct RequestMetricContext {
    started_at: String,
    start_instant: Instant,
    method: String,
    path: String,
    protocol: RequestProtocol,
    app_id: String,
    app_label: String,
    provider_id: String,
    provider_label: String,
    token_limit: Option<u64>,
    listen_port: u16,
    request_model: Option<String>,
    target_model: Option<String>,
    estimated_input_tokens: u64,
}

#[derive(Default)]
struct ParsedUsage {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    response_model: Option<String>,
}

/// Catch-all proxy handler: reads body → matches route → adapts protocol → forwards → returns response.
/// SSE streaming detection and passthrough is handled here.
///
/// The local proxy accepts two standard API styles:
/// - OpenAI style: POST /v1/chat/completions with Authorization: Bearer <token>
/// - Anthropic style: POST /v1/messages with x-api-key: <token>
///
/// Protocol adaptation is performed transparently in the forwarder — the client
/// is completely unaware of the upstream provider's API style.
///
/// For connectivity/health-check requests (e.g. Claude Code startup probe),
/// returns a simple 200 OK so the client knows the proxy is reachable.
///
/// Auth verification: the client must send the AAStation proxy auth token
/// via `x-api-key` or `Authorization: Bearer <token>`. Requests without
/// a valid token are rejected with 401. The token is NOT forwarded to
/// upstream — the Provider node's API key is used instead.
pub async fn proxy_handler(
    axum::extract::State(state): axum::extract::State<HandlerState>,
    req: Request,
) -> Response {
    let request_started_at = Utc::now().to_rfc3339();
    let request_started_instant = Instant::now();

    // Increment request counter
    state
        .request_counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    // Decompose the incoming request (clone owned values before consuming req)
    let method = req.method().clone();
    let path = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_owned();
    let headers = req.headers().clone();

    // Handle connectivity/health-check requests from client applications.
    // Claude Code and similar tools send a GET/HEAD to the base URL on startup
    // to verify network connectivity. We intercept these and return 200 OK
    // without forwarding to any upstream — the proxy itself is the health signal.
    if is_connectivity_check(&method, &path) {
        return connectivity_check_response(&path);
    }

    // Verify proxy auth token
    let expected_token = state.proxy_auth_token.read().await;
    if !expected_token.is_empty() && !verify_auth_token(&headers, &expected_token) {
        return (
            StatusCode::UNAUTHORIZED,
            [("content-type", "application/json")],
            r#"{"error":{"type":"authentication_error","message":"Invalid or missing proxy auth token. Set ANTHROPIC_AUTH_TOKEN in your client config."}}"#,
        )
            .into_response();
    }
    drop(expected_token);

    // Read body bytes
    let body_bytes = match axum::body::to_bytes(req.into_body(), 200 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("Failed to read request body: {e}"),
            )
                .into_response();
        }
    };

    // Log the incoming request body
    if let Ok(body_str) = std::str::from_utf8(&body_bytes) {
        tracing::info!("← Client request body ({} {}): {}", method, path, body_str);
    } else {
        tracing::info!("← Client request body ({} {}): [{} bytes, non-UTF8]", method, path, body_bytes.len());
    }

    // Extract model field from body for model-based routing
    let model = extract_model(&body_bytes);

    // Detect client's request protocol (needed for response adaptation)
    let source_protocol = detect_request_protocol(&path);

    // Match route
    let route_table = state.route_table.read().await;
    tracing::info!(
        "Incoming request: {} {} (model: {:?}, routes: {}, has_default: {}, workflow: {})",
        method,
        path,
        model,
        route_table.routes.len(),
        route_table.default_route.is_some(),
        route_table.workflow.is_some(),
    );

    let workflow = route_table.workflow.as_ref().ok_or_else(|| {
        ProxyError::InvalidConfig("route table missing runtime workflow plan".to_string())
    });
    let runtime = WorkflowRuntime {
        metrics: state.metrics.clone(),
        poller_cursors: state.poller_cursors.clone(),
        provider_runtime: state.provider_runtime.clone(),
        poller_runtime: state.poller_runtime.clone(),
    };
    let match_result = match workflow {
        Ok(plan) => execute_workflow(plan, &runtime, &path, &headers, model.as_deref()).await,
        Err(err) => Err(err),
    };
    let matched_route = match match_result {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                "Route match failed for {} {} (model: {:?}): no matching route and no default",
                method, path, model,
            );
            drop(route_table);
            return e.into_response();
        }
    };

    let matched_route = matched_route.clone();
    let metric_ctx = RequestMetricContext {
        started_at: request_started_at,
        start_instant: request_started_instant,
        method: method.to_string(),
        path: path.clone(),
        protocol: source_protocol,
        app_id: route_table.app_id.clone(),
        app_label: route_table.app_label.clone(),
        provider_id: matched_route.provider_id.clone(),
        provider_label: matched_route.provider_label.clone(),
        token_limit: matched_route.token_limit,
        listen_port: state.listen_port,
        request_model: model.clone(),
        target_model: if matched_route.target_model.is_empty() {
            None
        } else {
            Some(matched_route.target_model.clone())
        },
        estimated_input_tokens: estimate_tokens_from_bytes(&body_bytes),
    };

    drop(route_table);

    // Forward the request to upstream
    let upstream_resp = match forward_request(
        &state.http_client,
        &matched_route,
        method,
        &path,
        headers,
        body_bytes,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => {
            record_metric(
                &state,
                &metric_ctx,
                None,
                false,
                Some(ParsedUsage {
                    input_tokens: metric_ctx.estimated_input_tokens,
                    output_tokens: 0,
                    total_tokens: metric_ctx.estimated_input_tokens,
                    response_model: None,
                }),
                Some(e.to_string()),
            )
            .await;
            return e.into_response();
        }
    };

    // Build the downstream response from upstream response
    build_response(upstream_resp, source_protocol, metric_ctx, &state).await
}

/// Determine if this request is a connectivity/health-check probe.
///
/// Claude Code (and similar tools) send GET/HEAD requests to the base URL
/// on startup to verify that the Anthropic API is reachable. When AAStation
/// acts as the proxy, these requests reach our server instead of the real
/// Anthropic API. We need to respond positively so the client can proceed.
///
/// A request is considered a connectivity check if:
/// - Method is GET or HEAD
/// - Path is a simple root-level path like `/`, `/v1`, `/v1/`
/// - No API-specific path like `/v1/messages` or `/v1/chat/completions`
fn is_connectivity_check(method: &axum::http::Method, path: &str) -> bool {
    // Only intercept GET and HEAD (typical health-check methods)
    if method != axum::http::Method::GET && method != axum::http::Method::HEAD {
        return false;
    }

    let trimmed = path.trim_end_matches('/');
    let trimmed = trimmed.strip_prefix('/').unwrap_or(trimmed);

    // Root path
    if trimmed.is_empty() {
        return true;
    }

    // Version-only paths like /v1, /v1/
    if trimmed == "v1" {
        return true;
    }

    // Known lightweight health-check / discovery endpoints that don't need forwarding
    // OpenAI-style: /v1/models
    // Anthropic-style: no specific endpoint, but some clients probe /v1
    if trimmed == "v1/models" {
        return true;
    }

    // Any known API endpoint path → NOT a connectivity check
    // These should be forwarded to the upstream provider
    false
}

/// Verify that the request carries the correct AAStation proxy auth token.
///
/// The token can be provided via:
/// - `x-api-key` header (Anthropic-style)
/// - `Authorization: Bearer <token>` header (OpenAI-style)
fn verify_auth_token(headers: &HeaderMap, expected: &str) -> bool {
    // Check x-api-key header first (Anthropic style)
    if let Some(val) = headers.get("x-api-key") {
        if let Ok(s) = val.to_str() {
            return s == expected;
        }
    }

    // Check Authorization: Bearer <token> (OpenAI style)
    if let Some(val) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(s) = val.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                return token == expected;
            }
        }
    }

    false
}

/// Build a response for connectivity check requests.
///
/// Returns a minimal JSON response that mimics what the Anthropic API
/// would return for a GET to the root path, so that client health checks
/// interpret the response as "service is reachable".
fn connectivity_check_response(path: &str) -> Response {
    let trimmed = path.trim_end_matches('/');
    let trimmed_stripped = trimmed.strip_prefix('/').unwrap_or(trimmed);

    // For root path, return a simple Anthropic-style welcome response
    if trimmed_stripped.is_empty() {
        let body = r#"{"type":"api","version":"2023-06-01"}"#;
        return (
            StatusCode::OK,
            [
                ("content-type", "application/json"),
                ("x-powered-by", "AAStation"),
            ],
            body,
        )
            .into_response();
    }

    // For /v1, return a minimal valid response
    if trimmed_stripped == "v1" {
        let body = r#"{"object":"list","data":[]}"#;
        return (
            StatusCode::OK,
            [
                ("content-type", "application/json"),
                ("x-powered-by", "AAStation"),
            ],
            body,
        )
            .into_response();
    }

    // For /v1/models (OpenAI-style model list probe), return empty list
    if trimmed_stripped == "v1/models" {
        let body = r#"{"object":"list","data":[]}"#;
        return (
            StatusCode::OK,
            [
                ("content-type", "application/json"),
                ("x-powered-by", "AAStation"),
            ],
            body,
        )
            .into_response();
    }

    // Fallback
    (StatusCode::OK, "OK").into_response()
}

/// Convert an upstream reqwest::Response into an axum Response.
/// SSE responses are streamed through; non-SSE responses are buffered fully.
/// When the client is using Anthropic protocol, SSE streams are patched to ensure
/// compatibility (e.g. adding missing `input_tokens` in `message_start` usage).
async fn build_response(
    upstream: reqwest::Response,
    source_protocol: RequestProtocol,
    metric_ctx: RequestMetricContext,
    state: &HandlerState,
) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    // Copy response headers
    let mut response_headers = HeaderMap::new();
    for (name, value) in upstream.headers() {
        if let Ok(header_name) = axum::http::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(header_value) = HeaderValue::from_bytes(value.as_bytes()) {
                response_headers.insert(header_name, header_value);
            }
        }
    }

    // SSE detection: stream passthrough
    if is_sse_response(&upstream.headers()) {
        tracing::info!("← Upstream SSE stream response (status: {})", status);
        let (bytes_tx, bytes_rx) = oneshot::channel::<u64>();
        let raw_stream: super::stream::BoxStream = if source_protocol == RequestProtocol::Anthropic {
            // Patch Anthropic SSE to fix missing fields (e.g. input_tokens in usage)
            let patched = AnthropicSsePatchStream::new(upstream.bytes_stream());
            Box::pin(patched)
        } else {
            let logged = LoggedStream::new(upstream.bytes_stream());
            Box::pin(logged)
        };
        let body = Body::from_stream(MeteredStream::new(raw_stream, bytes_tx));

        let state_for_metrics = state.clone();
        let metric_ctx_for_metrics = metric_ctx.clone();
        tokio::spawn(async move {
            let output_bytes = bytes_rx.await.unwrap_or(0);
            let usage = ParsedUsage {
                input_tokens: metric_ctx_for_metrics.estimated_input_tokens,
                output_tokens: estimate_tokens_from_len(output_bytes),
                total_tokens: metric_ctx_for_metrics
                    .estimated_input_tokens
                    .saturating_add(estimate_tokens_from_len(output_bytes)),
                response_model: None,
            };
            record_metric(
                &state_for_metrics,
                &metric_ctx_for_metrics,
                Some(status),
                true,
                Some(usage),
                None,
            )
            .await;
        });
        return (status, response_headers, body).into_response();
    }

    // Non-SSE: buffer the full body
    let body_bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to read upstream response body: {e}");
            record_metric(
                state,
                &metric_ctx,
                Some(StatusCode::BAD_GATEWAY),
                false,
                Some(ParsedUsage {
                    input_tokens: metric_ctx.estimated_input_tokens,
                    output_tokens: 0,
                    total_tokens: metric_ctx.estimated_input_tokens,
                    response_model: None,
                }),
                Some(err_msg.clone()),
            )
            .await;
            return (
                StatusCode::BAD_GATEWAY,
                err_msg,
            )
                .into_response();
        }
    };

    // Patch non-SSE Anthropic responses to ensure usage fields are present.
    // Some providers (e.g. Zhipu) return Anthropic-compatible JSON but with
    // missing `input_tokens` in `usage`, which crashes Claude Code.
    let body_bytes = if source_protocol == RequestProtocol::Anthropic {
        patch_anthropic_json_response(&body_bytes)
    } else {
        body_bytes
    };

    let parsed_usage = ParsedUsage {
        input_tokens: metric_ctx.estimated_input_tokens,
        output_tokens: estimate_tokens_from_bytes(&body_bytes),
        total_tokens: metric_ctx
            .estimated_input_tokens
            .saturating_add(estimate_tokens_from_bytes(&body_bytes)),
        response_model: parse_response_model(&body_bytes),
    };
    record_metric(
        state,
        &metric_ctx,
        Some(status),
        false,
        Some(parsed_usage),
        None,
    )
    .await;

    // Log the upstream response body
    if let Ok(body_str) = std::str::from_utf8(&body_bytes) {
        tracing::info!("← Upstream response body (status: {}): {}", status, body_str);
    } else {
        tracing::info!("← Upstream response body (status: {}): [{} bytes, non-UTF8]", status, body_bytes.len());
    }

    (status, response_headers, body_bytes.to_vec()).into_response()
}

/// Patch a non-SSE Anthropic JSON response to ensure `usage` fields are present.
///
/// Some providers (e.g. Zhipu) return Anthropic-compatible responses but with
/// incomplete `usage` objects — missing `input_tokens` or even the entire `usage` field.
/// Claude Code expects `usage.input_tokens` to always be present, and crashes with
/// "undefined is not an object (evaluating '$.input_tokens')" if it's missing.
///
/// This function ensures:
/// - Top-level `usage` exists and has `input_tokens` and `output_tokens`
/// - `message_start`-style nested `message.usage` is also patched if present
fn patch_anthropic_json_response(body: &[u8]) -> bytes::Bytes {
    let mut value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return bytes::Bytes::from(body.to_vec()),
    };

    let mut patched = false;

    // Patch top-level usage (standard Anthropic response format)
    if let Some(obj) = value.as_object_mut() {
        // Check if this looks like an Anthropic response (has "usage" or is inside "message")
        if obj.contains_key("usage") || obj.contains_key("type") {
            if let Some(obj) = value.as_object_mut() {
                patched |= ensure_usage_in_obj(obj, true);
            }
        }

        // Patch nested message.usage (message_start style)
        if let Some(msg) = value.get_mut("message") {
            if let Some(msg_obj) = msg.as_object_mut() {
                patched |= ensure_usage_in_obj(msg_obj, true);
            }
        }
    }

    if patched {
        match serde_json::to_vec(&value) {
            Ok(bytes) => bytes::Bytes::from(bytes),
            Err(_) => bytes::Bytes::from(body.to_vec()),
        }
    } else {
        bytes::Bytes::from(body.to_vec())
    }
}

/// Ensure a JSON object has a proper `usage` field with `input_tokens` and `output_tokens`.
/// Returns true if any patching was applied.
fn ensure_usage_in_obj(obj: &mut serde_json::Map<String, serde_json::Value>, needs_input: bool) -> bool {
    match obj.get_mut("usage") {
        Some(usage) if usage.is_object() => {
            let usage_obj = usage.as_object_mut().unwrap();
            let mut patched = false;
            if needs_input && !usage_obj.contains_key("input_tokens") {
                usage_obj.insert(
                    "input_tokens".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(0)),
                );
                patched = true;
            }
            if !usage_obj.contains_key("output_tokens") {
                usage_obj.insert(
                    "output_tokens".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(0)),
                );
                patched = true;
            }
            patched
        }
        Some(usage) if usage.is_null() || !usage.is_object() => {
            // usage is null or not an object — replace with default
            if needs_input {
                obj.insert(
                    "usage".to_string(),
                    serde_json::json!({"input_tokens": 0, "output_tokens": 0}),
                );
            } else {
                obj.insert(
                    "usage".to_string(),
                    serde_json::json!({"output_tokens": 0}),
                );
            }
            true
        }
        _ => false,
    }
}

fn parse_response_model(body: &[u8]) -> Option<String> {
    let value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return None,
    };

    value.get("model").and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn estimate_tokens_from_bytes(bytes: &[u8]) -> u64 {
    estimate_tokens_from_len(bytes.len() as u64)
}

fn estimate_tokens_from_len(len: u64) -> u64 {
    if len == 0 {
        0
    } else {
        (len + 3) / 4
    }
}

async fn record_metric(
    state: &HandlerState,
    ctx: &RequestMetricContext,
    status: Option<StatusCode>,
    streamed: bool,
    usage: Option<ParsedUsage>,
    error: Option<String>,
) {
    let usage = usage.unwrap_or_default();
    let completed_at = Utc::now().to_rfc3339();
    let duration_ms = ctx.start_instant.elapsed().as_millis() as u64;
    let success = status.map(|s| s.is_success()).unwrap_or(false) && error.is_none();

    state
        .metrics
        .record(ProxyRequestMetric {
            id: String::new(),
            app_id: ctx.app_id.clone(),
            app_label: ctx.app_label.clone(),
            provider_id: ctx.provider_id.clone(),
            provider_label: ctx.provider_label.clone(),
            listen_port: ctx.listen_port,
            method: ctx.method.clone(),
            path: ctx.path.clone(),
            protocol: match ctx.protocol {
                RequestProtocol::Anthropic => "anthropic".to_string(),
                RequestProtocol::OpenAI => "openai".to_string(),
            },
            request_model: ctx.request_model.clone(),
            target_model: ctx.target_model.clone(),
            response_model: usage.response_model,
            status_code: status.map(|s| s.as_u16()),
            success,
            streamed,
            duration_ms,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            started_at: ctx.started_at.clone(),
            completed_at,
            error: error.clone(),
        })
        .await;

    let cumulative_used_tokens = state
        .metrics
        .provider_summary(&ctx.provider_id)
        .await
        .map(|summary| summary.summary.total_tokens)
        .unwrap_or(usage.total_tokens);

    state
        .provider_runtime
        .record_request_result(
            &ctx.provider_id,
            &ctx.provider_label,
            ctx.token_limit.unwrap_or(0),
            cumulative_used_tokens,
            success,
            error,
        )
        .await;
}
