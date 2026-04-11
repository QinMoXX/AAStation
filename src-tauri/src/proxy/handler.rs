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
