#![allow(dead_code, unused_imports)]

use bytes::Bytes;
use futures::Stream;
use std::pin::Pin;
use std::task::{Context, Poll};

/// A stream wrapper that patches Anthropic SSE events to ensure compatibility
/// with clients like Claude Code.
///
/// Specifically, it fixes the `message_start` event by ensuring the `usage` object
/// contains `input_tokens` (defaults to 0 if missing). Some providers (e.g. Zhipu)
/// return Anthropic-compatible SSE but with incomplete `usage` fields, which causes
/// Claude Code to crash with "undefined is not an object (evaluating '$.input_tokens')".
pub struct AnthropicSsePatchStream<S> {
    inner: S,
    /// Buffer for incomplete SSE data that may span across chunks
    buffer: String,
}

impl<S> AnthropicSsePatchStream<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            buffer: String::new(),
        }
    }
}

impl<S> Stream for AnthropicSsePatchStream<S>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(chunk))) => {
                let text = match std::str::from_utf8(&chunk) {
                    Ok(s) => s,
                    Err(_) => return Poll::Ready(Some(Ok(chunk))),
                };

                // Prepend any buffered data from previous chunk
                self.buffer.push_str(text);
                let patched = patch_sse_buffer(&mut self.buffer);
                Poll::Ready(Some(Ok(Bytes::from(patched))))
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                e.to_string(),
            )))),
            Poll::Ready(None) => {
                // Flush remaining buffer
                if !self.buffer.is_empty() {
                    let remaining = std::mem::take(&mut self.buffer);
                    Poll::Ready(Some(Ok(Bytes::from(remaining))))
                } else {
                    Poll::Ready(None)
                }
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Process the SSE buffer, patching complete events and retaining incomplete ones.
///
/// SSE format:
/// ```text
/// event: message_start
/// data: {"type":"message_start","message":{...}}
///
/// ```
///
/// Events are separated by blank lines. We process complete events (those followed
/// by a blank line) and keep incomplete ones in the buffer for the next chunk.
fn patch_sse_buffer(buffer: &mut String) -> String {
    let mut output = String::new();

    // Split on double newlines (SSE event boundaries)
    // We look for "\n\n" which marks the end of an event
    while let Some(pos) = buffer.find("\n\n") {
        let event_text = buffer[..pos + 2].to_string();
        buffer.drain(..pos + 2);
        output.push_str(&patch_sse_event(&event_text));
    }

    output
}

/// Patch a single SSE event if it contains `usage` that needs fixing.
///
/// Handles:
/// - `message_start`: ensures `message.usage` has `input_tokens` and `output_tokens`
/// - `message_delta`: ensures top-level `usage` has `output_tokens`
fn patch_sse_event(event_text: &str) -> String {
    // Determine event type from the "event:" line
    let event_type = event_text.lines().find_map(|line| {
        line.strip_prefix("event:").map(|v| v.trim().to_string())
    });

    let mut is_message_start = event_type.as_deref() == Some("message_start");
    let mut is_message_delta = event_type.as_deref() == Some("message_delta");

    // If no "event:" line was found, try to detect type from the data JSON's "type" field.
    // Some providers omit the "event:" line and only send "data:" lines.
    if event_type.is_none() {
        if let Some(data_line) = event_text.lines().find_map(|line| {
            line.strip_prefix("data:").map(|s| s.trim_start())
        }) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data_line) {
                match val.get("type").and_then(|t| t.as_str()) {
                    Some("message_start") => is_message_start = true,
                    Some("message_delta") => is_message_delta = true,
                    _ => {}
                }
            }
        }
    }

    if !is_message_start && !is_message_delta {
        return event_text.to_string();
    }

    // Find and patch the data line
    let mut patched = String::new();
    for line in event_text.lines() {
        if let Some(data_json) = line.strip_prefix("data:").map(|s| s.trim_start()) {
            match serde_json::from_str::<serde_json::Value>(data_json) {
                Ok(mut value) => {
                    if is_message_start {
                        // Patch message.usage
                        if let Some(msg) = value.get_mut("message") {
                            if let Some(msg_obj) = msg.as_object_mut() {
                                ensure_usage_fields(msg_obj, true);
                            }
                        }
                    } else if is_message_delta {
                        // Patch top-level usage in message_delta
                        if let Some(obj) = value.as_object_mut() {
                            ensure_usage_fields(obj, false);
                        }
                    }
                    patched.push_str("data: ");
                    patched.push_str(&serde_json::to_string(&value).unwrap_or_else(|_| data_json.to_string()));
                    patched.push('\n');
                }
                Err(_) => {
                    patched.push_str(line);
                    patched.push_str("\n");
                }
            }
        } else {
            patched.push_str(line);
            patched.push('\n');
        }
    }
    // Add trailing newline for event separator
    patched.push('\n');

    patched
}

/// Ensure a JSON object has a proper `usage` field with required tokens.
///
/// For `message_start` (needs_input=true): ensures `input_tokens` and `output_tokens`.
/// For `message_delta` (needs_input=false): ensures `output_tokens`.
fn ensure_usage_fields(obj: &mut serde_json::Map<String, serde_json::Value>, needs_input: bool) {
    match obj.get_mut("usage") {
        Some(usage) if usage.is_object() => {
            let usage_obj = usage.as_object_mut().unwrap();
            if needs_input && !usage_obj.contains_key("input_tokens") {
                usage_obj.insert(
                    "input_tokens".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(0)),
                );
            }
            if !usage_obj.contains_key("output_tokens") {
                usage_obj.insert(
                    "output_tokens".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(0)),
                );
            }
        }
        _ => {
            // usage is null, missing, or not an object — replace with default
            if needs_input {
                obj.insert(
                    "usage".to_string(),
                    serde_json::json!({
                        "input_tokens": 0,
                        "output_tokens": 0
                    }),
                );
            } else {
                obj.insert(
                    "usage".to_string(),
                    serde_json::json!({
                        "output_tokens": 0
                    }),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_message_start_with_missing_usage() {
        let event = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"glm-4-plus\",\"stop_reason\":null,\"stop_sequence\":null}}\n\n";
        let result = patch_sse_event(event);
        assert!(result.contains("\"input_tokens\":0"));
        assert!(result.contains("\"output_tokens\":0"));
    }

    #[test]
    fn test_patch_message_start_with_null_usage() {
        let event = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"glm-4-plus\",\"usage\":null}}\n\n";
        let result = patch_sse_event(event);
        assert!(result.contains("\"input_tokens\":0"));
        assert!(result.contains("\"output_tokens\":0"));
    }

    #[test]
    fn test_patch_message_start_with_existing_input_tokens() {
        let event = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"glm-4-plus\",\"usage\":{\"input_tokens\":25,\"output_tokens\":0}}}\n\n";
        let result = patch_sse_event(event);
        assert!(result.contains("\"input_tokens\":25"));
        // Should not add duplicate
        assert!(!result.contains("\"input_tokens\":0"));
    }

    #[test]
    fn test_patch_non_message_start_unchanged() {
        let event = "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0}\n\n";
        let result = patch_sse_event(event);
        assert_eq!(result, event);
    }

    #[test]
    fn test_patch_buffer_splits_events() {
        let mut buffer = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"glm-4-plus\"}}\n\nevent: ping".to_string();
        let result = patch_sse_buffer(&mut buffer);
        // First event should be patched
        assert!(result.contains("\"input_tokens\":0"));
        // Second event is incomplete (no trailing \n\n), stays in buffer
        assert!(buffer.contains("event: ping"));
    }

    #[test]
    fn test_patch_message_delta_usage_already_present() {
        // message_delta with existing output_tokens — should pass through unchanged
        let event = "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":15}}\n\n";
        let result = patch_sse_event(event);
        assert!(result.contains("\"output_tokens\":15"));
        // message_delta should NOT add input_tokens
        assert!(!result.contains("input_tokens"));
    }

    #[test]
    fn test_patch_message_delta_usage_missing_output_tokens() {
        // message_delta with missing output_tokens — should be patched
        let event = "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{}}\n\n";
        let result = patch_sse_event(event);
        assert!(result.contains("\"output_tokens\":0"));
    }
}
