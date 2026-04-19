#![allow(dead_code, unused_imports)]

use axum::http::{HeaderMap, HeaderValue, Method};

use super::body_parser::{adapt_request_body, adapt_request_path, detect_request_protocol, extract_model};
use super::error::ProxyError;
use super::types::{CompiledRoute, RequestProtocol};

/// Quick model extraction for logging (returns "N/A" if not found).
fn extract_model_quick(body: &[u8]) -> String {
    extract_model(body).unwrap_or_else(|| "N/A".to_string())
}

/// Check if a URL path ends with a version-like segment (e.g. /v1, /v2, /v4).
///
/// This is used to determine whether the base URL already includes the API version
/// prefix, which affects whether we should strip /v1 from the request path.
///
/// Examples:
///   - "https://api.anthropic.com/v1"       → true  (has /v1)
///   - "https://open.bigmodel.cn/api/paas/v4" → true (has /v4)
///   - "https://open.bigmodel.cn/api/anthropic" → false
///   - "https://api.openai.com/v1"          → true  (has /v1)
fn has_version_suffix(url: &str) -> bool {
    // Extract the path portion from the URL
    let path = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let path = path.split_once('?').map(|(p, _)| p).unwrap_or(path);
    // Strip the host portion to get just the path
    let path = path.find('/').map(|i| &path[i..]).unwrap_or("/");

    let last_segment = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    // Match version-like segments: /v1, /v2, /v4, etc.
    last_segment.starts_with('v') && last_segment.len() >= 2 && last_segment[1..].chars().all(|c| c.is_ascii_digit())
}

/// Determine the target API type based on the request protocol and available upstream URLs.
///
/// The routing logic is:
/// - If the client sends an Anthropic-style request AND an anthropic_upstream_url is set,
///   the target is Anthropic (same-protocol forwarding, no conversion needed).
/// - Otherwise, the target is OpenAI (the default protocol for baseUrl).
fn determine_target_api_type(source_protocol: RequestProtocol, route: &CompiledRoute) -> RequestProtocol {
    if source_protocol == RequestProtocol::Anthropic && route.anthropic_upstream_url.is_some() {
        RequestProtocol::Anthropic
    } else {
        RequestProtocol::OpenAI
    }
}

/// Forward the request to the matched upstream route.
///
/// This function performs protocol adaptation:
/// 1. Detects the client's request protocol (OpenAI or Anthropic) from the path
/// 2. Chooses the upstream URL based on the client's protocol:
///    - OpenAI-style requests → upstream_url (baseUrl)
///    - Anthropic-style requests → anthropic_upstream_url (if set), fallback to upstream_url
/// 3. Adapts the request path and body based on the target protocol
/// 4. Injects auth based on the target protocol
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

    // Choose upstream URL based on client protocol and available URLs.
    // If the client sends Anthropic-style request and an anthropic_upstream_url is set,
    // use that URL instead — this avoids the need for response format conversion
    // when the provider offers an Anthropic-compatible endpoint.
    let base_upstream_url = if source_protocol == RequestProtocol::Anthropic {
        route.anthropic_upstream_url.as_deref().unwrap_or(&route.upstream_url)
    } else {
        &route.upstream_url
    };

    // Determine the target protocol based on routing decision
    let target_protocol = determine_target_api_type(source_protocol, route);

    // Determine whether to preserve the /v1 prefix in the upstream path.
    //
    // The base_upstream_url may or may not include the version prefix:
    //   - "https://api.anthropic.com/v1"          → already has /v1, strip it from path
    //   - "https://open.bigmodel.cn/api/anthropic" → no /v1, keep it in path
    //   - "https://open.bigmodel.cn/api/paas/v4"   → has version-equivalent, strip it
    //
    // We detect this by checking if the base URL ends with a version-like segment
    // (e.g. /v1, /v2, /v4). If it does, the path adaptation should strip /v1 to avoid
    // duplication. Otherwise, preserve /v1 in the path.
    let base_trimmed = base_upstream_url.trim_end_matches('/');
    let preserve_v1_prefix = !has_version_suffix(base_trimmed);

    // Map RequestProtocol to ApiType for path adaptation
    let target_api_type = match target_protocol {
        RequestProtocol::Anthropic => super::body_parser::ApiType::Anthropic,
        RequestProtocol::OpenAI => super::body_parser::ApiType::OpenAI,
    };

    // Adapt the request path to match the provider's API type
    let upstream_path = adapt_request_path(path, target_api_type, preserve_v1_prefix);

    // Build the upstream URL
    let url = format!("{}{}", base_upstream_url.trim_end_matches('/'), upstream_path);

    tracing::info!(
        "Proxying {} {} → {} (protocol: {:?} → {:?}, model: {:?} → {:?})",
        method, path, url, source_protocol, target_protocol,
        extract_model_quick(&body), if route.target_model.is_empty() { "(keep)" } else { &route.target_model },
    );

    // Adapt the request body: protocol conversion + model replacement
    let body = adapt_request_body(&body, source_protocol, target_api_type, &route.target_model);
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

    // Inject auth based on target protocol
    match target_protocol {
        RequestProtocol::Anthropic => {
            req_builder = req_builder.header("x-api-key", &route.api_key);
            req_builder = req_builder.header("anthropic-version", "2023-06-01");
        }
        RequestProtocol::OpenAI => {
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
