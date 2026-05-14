use serde::Serialize;

/// Event emitted by the proxy handler when a request arrives or a response completes.
/// The floating monitor window listens for these to display chat bubbles.
#[derive(Debug, Clone, Serialize)]
pub struct ProxyMessageEvent {
    pub app_id: String,
    pub app_label: String,
    pub app_type: String,
    pub direction: String, // "incoming" | "outgoing"
    pub model: String,
    pub content_preview: String,
    pub timestamp: u64,
    pub request_id: String,
    pub status_code: Option<u16>,
    pub duration_ms: Option<u64>,
    /// Whether the response is still streaming. Currently always false
    /// (events are emitted after the full response is received),
    /// reserved for future incremental streaming support.
    pub is_streaming: bool,
}
