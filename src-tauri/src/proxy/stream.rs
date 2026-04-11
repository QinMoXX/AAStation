#![allow(dead_code)]

use axum::http::HeaderMap;
use futures::Stream;
use std::pin::Pin;

/// Check if the response is an SSE stream by inspecting Content-Type.
pub fn is_sse_response(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.starts_with("text/event-stream"))
        .unwrap_or(false)
}

/// A streaming body wrapper that maps reqwest byte chunks to axum body chunks.
/// Used for SSE passthrough — each chunk is forwarded immediately.
pub type BoxStream = Pin<Box<dyn Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>;
