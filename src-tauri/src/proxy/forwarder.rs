#![allow(dead_code, unused_imports)]

use axum::http::{HeaderMap, HeaderValue, Method};

use super::body_parser::{adapt_request_body, adapt_request_path, detect_request_protocol, extract_model};
use super::error::ProxyError;
use super::types::{ApiType, CompiledRoute, RequestProtocol};

/// Quick model extraction for logging (returns "N/A" if not found).
fn extract_model_quick(body: &[u8]) -> String {
    extract_model(body).unwrap_or_else(|| "N/A".to_string())
}

/// Forward the request to the matched upstream route.
///
/// This function performs protocol adaptation:
/// 1. Detects the client's request protocol (OpenAI or Anthropic) from the path
/// 2. Adapts the request path to match the provider's API type
/// 3. Adapts the request body (field conversion between protocols)
/// 4. Injects auth based on the provider's api_type
///
/// The client is completely unaware of the provider's API style.
pub async fn forward_request(
    client: &reqwest::Client,
    route: &CompiledRoute,
    method: Method,
    path: &str,
    headers: HeaderMap<HeaderValue>,
    body: bytes::Bytes,
) -> Result<reqwest::Response, ProxyError> {
    // Detect client's request protocol from the original path
    let source_protocol = detect_request_protocol(path);

    // Determine the target API type from the compiled route
    let target_api_type = route.api_type.unwrap_or(ApiType::OpenAI);

    // Choose upstream URL based on client protocol and available URLs.
    // If the client sends Anthropic-style request and an anthropic_upstream_url is set,
    // use that URL instead — this avoids the need for response format conversion
    // when the provider offers an Anthropic-compatible endpoint.
    let base_upstream_url = if source_protocol == RequestProtocol::Anthropic {
        route.anthropic_upstream_url.as_deref().unwrap_or(&route.upstream_url)
    } else {
        &route.upstream_url
    };

    // When using anthropic_upstream_url, the target API type is effectively Anthropic
    let effective_api_type = if source_protocol == RequestProtocol::Anthropic && route.anthropic_upstream_url.is_some() {
        ApiType::Anthropic
    } else {
        target_api_type
    };

    // Adapt the request path to match the provider's API type
    let upstream_path = adapt_request_path(path, effective_api_type);

    // Build the upstream URL
    let url = format!("{}{}", base_upstream_url.trim_end_matches('/'), upstream_path);

    tracing::info!(
        "Proxying {} {} → {} (protocol: {:?} → {:?}, model: {:?} → {:?})",
        method, path, url, source_protocol, effective_api_type,
        extract_model_quick(&body), if route.target_model.is_empty() { "(keep)" } else { &route.target_model },
    );

    // Adapt the request body: protocol conversion + model replacement
    let body = adapt_request_body(&body, source_protocol, effective_api_type, &route.target_model);
    let body = bytes::Bytes::from(body);

    // Log the outgoing request body
    if let Ok(body_str) = std::str::from_utf8(&body) {
        tracing::info!("→ Upstream request body ({} {}): {}", method, url, body_str);
    } else {
        tracing::info!("→ Upstream request body ({} {}): [{} bytes, non-UTF8]", method, url, body.len());
    }

    let mut req_builder = client.request(method, &url).body(body);

    // Copy original headers, excluding hop-by-hop headers and content-length
    // (content-length must match the actual body after potential model replacement,
    //  so we let reqwest set it automatically)
    for (name, value) in headers.iter() {
        if name == axum::http::header::HOST
            || name == axum::http::header::AUTHORIZATION
            || name == "x-api-key"
            || name == "anthropic-version"
            || name == axum::http::header::CONTENT_LENGTH
            || name == axum::http::header::TRANSFER_ENCODING
            || name == axum::http::header::CONNECTION
            || name == "upgrade"
        {
            continue;
        }
        req_builder = req_builder.header(name, value);
    }

    // Inject auth based on effective API type
    match effective_api_type {
        ApiType::Anthropic => {
            req_builder = req_builder.header("x-api-key", &route.api_key);
            req_builder = req_builder.header("anthropic-version", "2023-06-01");
        }
        ApiType::OpenAI => {
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
        .map_err(|e| {
            let detail = if e.is_connect() {
                format!("connection failed: {} (url: {})", e, url)
            } else if e.is_timeout() {
                format!("request timed out: {} (url: {})", e, url)
            } else {
                format!("{} (url: {})", e, url)
            };
            ProxyError::UpstreamError(detail)
        })
}
