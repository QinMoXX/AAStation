#![allow(dead_code, unused_imports)]

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

use super::body_parser::extract_model;
use super::error::ProxyError;
use super::forwarder::forward_request;
use super::router::match_route;
use super::server::HandlerState;
use super::stream::{is_sse_response, LoggedStream};

/// Catch-all proxy handler: reads body → matches route → forwards → returns response.
/// SSE streaming detection and passthrough is handled here.
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

    // Extract model field from body for model-based routing
    let model = extract_model(&body_bytes);

    // Match route
    let route_table = state.route_table.read().await;
    let match_result = match_route(&route_table.routes, &route_table.default_route, &path, &headers, model.as_deref());
    let matched_route = match match_result {
        Ok(r) => r,
        Err(e) => {
            drop(route_table);
            return e.into_response();
        }
    };

    // Forward the request to upstream
    let upstream_resp = match forward_request(
        &state.http_client,
        matched_route,
        method,
        &path,
        headers,
        body_bytes,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => {
            drop(route_table);
            return e.into_response();
        }
    };

    drop(route_table);

    // Build the downstream response from upstream response
    build_response(upstream_resp).await
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

    // Root path
    if trimmed.is_empty() || trimmed == "/" {
        return true;
    }

    // Version-only paths like /v1, /v1/
    if trimmed == "/v1" {
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

    // For root path, return a simple Anthropic-style welcome response
    if trimmed.is_empty() || trimmed == "/" {
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
    if trimmed == "/v1" {
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
async fn build_response(upstream: reqwest::Response) -> Response {
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
        let logged = LoggedStream::new(upstream.bytes_stream());
        let body = Body::from_stream(logged);
        return (status, response_headers, body).into_response();
    }

    // Non-SSE: buffer the full body
    let body_bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read upstream response body: {e}"),
            )
                .into_response();
        }
    };

    (status, response_headers, body_bytes.to_vec()).into_response()
}
