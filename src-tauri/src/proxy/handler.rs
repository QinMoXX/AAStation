#![allow(dead_code, unused_imports)]

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

use super::error::ProxyError;
use super::forwarder::forward_request;
use super::server::HandlerState;
use super::stream::{is_sse_response, LoggedStream};
use super::types::{CompiledRoute, MatchType};

/// Catch-all proxy handler: reads body → matches route → forwards → returns response.
/// SSE streaming detection and passthrough is handled here.
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

/// Match a request against the route table.
/// Priority: path_prefix → header → model, then default route.
fn match_route<'a>(
    routes: &'a [CompiledRoute],
    default_route: &'a Option<CompiledRoute>,
    path: &str,
    headers: &HeaderMap,
    model: Option<&str>,
) -> Result<&'a CompiledRoute, ProxyError> {
    // 1. Try path_prefix matches
    for route in routes {
        if matches!(route.match_type, MatchType::PathPrefix) && path.starts_with(&route.pattern) {
            return Ok(route);
        }
    }

    // 2. Try header matches (pattern format: "Header-Name:value")
    for route in routes {
        if matches!(route.match_type, MatchType::Header) {
            if let Some((header_name, header_value)) = route.pattern.split_once(':') {
                if headers
                    .get(header_name)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v == header_value)
                    .unwrap_or(false)
                {
                    return Ok(route);
                }
            }
        }
    }

    // 3. Try model matches
    if let Some(req_model) = model {
        for route in routes {
            if matches!(route.match_type, MatchType::Model) && route.pattern == req_model {
                return Ok(route);
            }
        }
    }

    // 4. Fall back to default route
    if let Some(ref route) = default_route {
        return Ok(route);
    }

    Err(ProxyError::NoMatch)
}

/// Extract the `model` field from a JSON request body.
/// Returns None if body is not valid JSON or field is absent.
fn extract_model(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("model")?.as_str().map(|s| s.to_string()))
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
