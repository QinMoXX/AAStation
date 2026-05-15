#![allow(dead_code)]

use axum::http::HeaderMap;
use futures::Stream;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use tokio::sync::oneshot;

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

/// A logging wrapper around a byte stream (e.g. reqwest `bytes_stream()`).
///
/// Each successfully received chunk is forwarded as-is.
/// Errors from the inner stream are logged and converted to `std::io::Error`
/// so that axum's `Body::from_stream` can consume them.
pub struct LoggedStream<S> {
    inner: S,
}

impl<S> LoggedStream<S> {
    pub fn new(inner: S) -> Self {
        Self { inner }
    }
}

/// A stream wrapper that counts forwarded bytes and reports them when finished.
/// This is used to estimate output tokens for SSE responses.
pub struct MeteredStream<S> {
    inner: S,
    total_bytes: u64,
    done_tx: Option<oneshot::Sender<u64>>,
    _attachment: Option<Box<dyn Send>>,
}

impl<S> MeteredStream<S> {
    pub fn new(inner: S, done_tx: oneshot::Sender<u64>) -> Self {
        Self {
            inner,
            total_bytes: 0,
            done_tx: Some(done_tx),
            _attachment: None,
        }
    }

    pub fn with_attachment<T: Send + 'static>(inner: S, done_tx: oneshot::Sender<u64>, attachment: T) -> Self {
        Self {
            inner,
            total_bytes: 0,
            done_tx: Some(done_tx),
            _attachment: Some(Box::new(attachment)),
        }
    }

    fn finish(&mut self) {
        if let Some(tx) = self.done_tx.take() {
            let _ = tx.send(self.total_bytes);
        }
    }
}

impl<S> Drop for MeteredStream<S> {
    fn drop(&mut self) {
        self.finish();
    }
}

impl<S> Stream for MeteredStream<S>
where
    S: Stream<Item = Result<bytes::Bytes, std::io::Error>> + Unpin,
{
    type Item = Result<bytes::Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(chunk))) => {
                self.total_bytes = self.total_bytes.saturating_add(chunk.len() as u64);
                Poll::Ready(Some(Ok(chunk)))
            }
            Poll::Ready(Some(Err(e))) => {
                self.finish();
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                self.finish();
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl<S> Stream for LoggedStream<S>
where
    S: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Unpin,
{
    type Item = Result<bytes::Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(chunk))) => Poll::Ready(Some(Ok(chunk))),
            Poll::Ready(Some(Err(e))) => {
                eprintln!("SSE stream error: {e}");
                Poll::Ready(Some(Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    e.to_string(),
                ))))
            }
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// A stream wrapper that captures text content from SSE events while forwarding
/// chunks unchanged. The accumulated text is shared via `Arc<Mutex<String>>` so
/// the caller (in `handler.rs`) can read it after the stream completes and emit
/// a follow-up message event with the actual response content.
///
/// Recognised SSE delta formats:
/// - Anthropic: `{"type":"content_block_delta","delta":{"text":"..."}}`
/// - OpenAI:    `{"choices":[{"delta":{"content":"..."}}]}`
pub struct SseContentCaptureStream<S> {
    inner: S,
    /// Incomplete SSE data that spans across chunks.
    buffer: String,
    /// Accumulated text content extracted from complete SSE events.
    text: Arc<Mutex<String>>,
}

impl<S> SseContentCaptureStream<S> {
    /// Create a new wrapper and return a handle for reading captured text.
    pub fn new_with_handle(inner: S) -> (Self, Arc<Mutex<String>>) {
        let text = Arc::new(Mutex::new(String::new()));
        (
            Self { inner, buffer: String::new(), text: text.clone() },
            text,
        )
    }
}

impl<S> Stream for SseContentCaptureStream<S>
where
    S: Stream<Item = Result<bytes::Bytes, std::io::Error>> + Unpin,
{
    type Item = Result<bytes::Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(chunk))) => {
                if let Ok(s) = std::str::from_utf8(&chunk) {
                    self.buffer.push_str(s);
                    let new_text = extract_sse_delta_text(&mut self.buffer);
                    if !new_text.is_empty() {
                        if let Ok(mut t) = self.text.lock() {
                            t.push_str(&new_text);
                        }
                    }
                }
                Poll::Ready(Some(Ok(chunk)))
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
            Poll::Ready(None) => {
                if !self.buffer.is_empty() {
                    let new_text = extract_sse_delta_text(&mut self.buffer);
                    if !new_text.is_empty() {
                        if let Ok(mut t) = self.text.lock() {
                            t.push_str(&new_text);
                        }
                    }
                }
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Extract text content from complete SSE events in the buffer.
/// Events are separated by double-newlines. Complete events are removed from
/// the buffer; incomplete ones stay for the next chunk.
fn extract_sse_delta_text(buffer: &mut String) -> String {
    let mut text = String::new();

    while let Some(pos) = buffer.find("\n\n") {
        let event_text = buffer[..pos + 2].to_string();
        buffer.drain(..pos + 2);

        for line in event_text.lines() {
            let data_json = match line.strip_prefix("data:") {
                Some(s) => s.trim_start(),
                None => continue,
            };
            let value: serde_json::Value = match serde_json::from_str(data_json) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Anthropic content_block_delta: delta.text
            if let Some(t) = value
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|v| v.as_str())
            {
                text.push_str(t);
            }

            // OpenAI: choices[0].delta.content
            if let Some(t) = value
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|v| v.as_str())
            {
                text.push_str(t);
            }
        }
    }

    text
}
