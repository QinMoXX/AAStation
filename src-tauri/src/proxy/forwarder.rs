#![allow(dead_code, unused_imports)]

use axum::http::{HeaderMap, HeaderValue, Method};
use axum::body::Body;
use axum::response::Response;

use super::body_parser::replace_model;
use super::error::ProxyError;
use super::server::HandlerState;
use super::types::{ApiType, CompiledRoute};

/// Forward the request to the matched upstream route.
/// Builds a reqwest request with the same method/headers/body,
/// injects auth based on the route's api_type, then sends it.
///
/// If `route.target_model` is set, replaces the `model` field in the request body.
///
/// Returns the upstream response (streaming or buffered).
pub async fn forward_request(
    client: &reqwest::Client,
    route: &CompiledRoute,
    method: Method,
    path: &str,
    headers: HeaderMap<HeaderValue>,
    body: bytes::Bytes,
) -> Result<reqwest::Response, ProxyError> {
    let url = format!("{}{}", route.upstream_url.trim_end_matches('/'), path);

    // Replace model in body if target_model is specified
    let body = if !route.target_model.is_empty() {
        replace_model(&body, &route.target_model).map(bytes::Bytes::from).unwrap_or(body)
    } else {
        body
    };

    let mut req_builder = client.request(method, &url).body(body);

    // Copy original headers, excluding Host and auth headers
    for (name, value) in headers.iter() {
        if name == axum::http::header::HOST
            || name == axum::http::header::AUTHORIZATION
            || name == "x-api-key"
        {
            continue;
        }
        req_builder = req_builder.header(name, value);
    }

    // Inject auth based on API type
    match route.api_type {
        Some(ApiType::Anthropic) => {
            req_builder = req_builder.header("x-api-key", &route.api_key);
            req_builder = req_builder.header("anthropic-version", "2023-06-01");
        }
        Some(ApiType::OpenAI) | None => {
            req_builder = req_builder.bearer_auth(&route.api_key);
        }
    }

    // Inject extra headers from route config
    for (key, val) in &route.extra_headers {
        req_builder = req_builder.header(key.as_str(), val.as_str());
    }

    req_builder
        .send()
        .await
        .map_err(|e| ProxyError::UpstreamError(e.to_string()))
}
