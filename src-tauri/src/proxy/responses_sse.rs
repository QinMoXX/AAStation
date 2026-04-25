#![allow(dead_code)]

use bytes::Bytes;
use futures::Stream;
use serde_json::json;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct ResponsesBridgeState {
    buffer: String,
    response_id: Option<String>,
    model: Option<String>,
    created_at: Option<u64>,
    accumulated_text: String,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    sent_created: bool,
    sent_completed: bool,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_usage(chunk: &serde_json::Value, state: &mut ResponsesBridgeState) {
    let usage = chunk.get("usage");
    if let Some(prompt) = usage.and_then(|u| u.get("prompt_tokens")).and_then(|v| v.as_u64()) {
        state.prompt_tokens = Some(prompt);
    }
    if let Some(completion) = usage.and_then(|u| u.get("completion_tokens")).and_then(|v| v.as_u64()) {
        state.completion_tokens = Some(completion);
    }
    if let Some(total) = usage.and_then(|u| u.get("total_tokens")).and_then(|v| v.as_u64()) {
        state.total_tokens = Some(total);
    }
}

fn ensure_core_fields(chunk: &serde_json::Value, state: &mut ResponsesBridgeState) {
    if state.response_id.is_none() {
        let base = chunk
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("aastation");
        state.response_id = Some(format!("resp_{base}"));
    }
    if state.model.is_none() {
        state.model = chunk
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some("unknown".to_string()));
    }
    if state.created_at.is_none() {
        state.created_at = chunk
            .get("created")
            .and_then(|v| v.as_u64())
            .or_else(|| Some(now_unix_secs()));
    }
    parse_usage(chunk, state);
}

fn build_response_created_event(state: &ResponsesBridgeState) -> String {
    let response_id = state
        .response_id
        .clone()
        .unwrap_or_else(|| "resp_aastation".to_string());
    let model = state
        .model
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let created_at = state.created_at.unwrap_or_else(now_unix_secs);
    let payload = json!({
        "type": "response.created",
        "response": {
            "id": response_id,
            "object": "response",
            "created_at": created_at,
            "status": "in_progress",
            "model": model,
            "output": []
        }
    });
    format!("event: response.created\ndata: {}\n\n", payload)
}

fn build_output_delta_event(state: &ResponsesBridgeState, delta: &str) -> String {
    let response_id = state
        .response_id
        .clone()
        .unwrap_or_else(|| "resp_aastation".to_string());
    let payload = json!({
        "type": "response.output_text.delta",
        "response_id": response_id,
        "output_index": 0,
        "content_index": 0,
        "delta": delta
    });
    format!("event: response.output_text.delta\ndata: {}\n\n", payload)
}

fn build_output_done_event(state: &ResponsesBridgeState) -> String {
    let response_id = state
        .response_id
        .clone()
        .unwrap_or_else(|| "resp_aastation".to_string());
    let payload = json!({
        "type": "response.output_text.done",
        "response_id": response_id,
        "output_index": 0,
        "content_index": 0,
        "text": state.accumulated_text
    });
    format!("event: response.output_text.done\ndata: {}\n\n", payload)
}

fn build_response_completed_event(state: &ResponsesBridgeState) -> String {
    let response_id = state
        .response_id
        .clone()
        .unwrap_or_else(|| "resp_aastation".to_string());
    let model = state
        .model
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let created_at = state.created_at.unwrap_or_else(now_unix_secs);
    let message_id = format!("msg_{response_id}");
    let usage = json!({
        "input_tokens": state.prompt_tokens.unwrap_or(0),
        "output_tokens": state.completion_tokens.unwrap_or(0),
        "total_tokens": state
            .total_tokens
            .unwrap_or(state.prompt_tokens.unwrap_or(0) + state.completion_tokens.unwrap_or(0))
    });
    let payload = json!({
        "type": "response.completed",
        "response": {
            "id": response_id,
            "object": "response",
            "created_at": created_at,
            "status": "completed",
            "model": model,
            "output": [{
                "type": "message",
                "id": message_id,
                "status": "completed",
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": state.accumulated_text,
                    "annotations": []
                }]
            }],
            "usage": usage
        }
    });
    format!("event: response.completed\ndata: {}\n\n", payload)
}

fn process_chat_chunk_event(event_text: &str, state: &mut ResponsesBridgeState) -> String {
    let mut output = String::new();
    for line in event_text.lines() {
        let Some(data) = line.strip_prefix("data:").map(|s| s.trim_start()) else {
            continue;
        };
        if data == "[DONE]" {
            if !state.sent_completed {
                if !state.sent_created {
                    output.push_str(&build_response_created_event(state));
                    state.sent_created = true;
                }
                output.push_str(&build_output_done_event(state));
                output.push_str(&build_response_completed_event(state));
                state.sent_completed = true;
            }
            return output;
        }

        let Ok(chunk) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        ensure_core_fields(&chunk, state);
        if !state.sent_created {
            output.push_str(&build_response_created_event(state));
            state.sent_created = true;
        }

        let choices = chunk
            .get("choices")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for choice in choices {
            let delta_content = choice
                .get("delta")
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str());
            if let Some(delta) = delta_content {
                state.accumulated_text.push_str(delta);
                output.push_str(&build_output_delta_event(state, delta));
            }

            let finished = choice.get("finish_reason").and_then(|v| v.as_str()).is_some();
            if finished && !state.sent_completed {
                output.push_str(&build_output_done_event(state));
                output.push_str(&build_response_completed_event(state));
                state.sent_completed = true;
            }
        }
    }
    output
}

fn bridge_sse_buffer(state: &mut ResponsesBridgeState) -> String {
    let mut output = String::new();
    while let Some(pos) = state.buffer.find("\n\n") {
        let event_text = state.buffer[..pos + 2].to_string();
        state.buffer.drain(..pos + 2);
        output.push_str(&process_chat_chunk_event(&event_text, state));
    }
    output
}

fn finalize_bridge(state: &mut ResponsesBridgeState) -> String {
    if !state.buffer.is_empty() {
        let trailing = std::mem::take(&mut state.buffer);
        let _ = process_chat_chunk_event(&trailing, state);
    }
    if state.sent_completed {
        return String::new();
    }
    let mut output = String::new();
    if !state.sent_created {
        output.push_str(&build_response_created_event(state));
        state.sent_created = true;
    }
    output.push_str(&build_output_done_event(state));
    output.push_str(&build_response_completed_event(state));
    state.sent_completed = true;
    output
}

/// Bridge OpenAI Chat Completions SSE stream to OpenAI Responses SSE stream.
pub struct OpenAiResponsesSseBridgeStream<S> {
    inner: S,
    state: ResponsesBridgeState,
}

impl<S> OpenAiResponsesSseBridgeStream<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            state: ResponsesBridgeState::default(),
        }
    }
}

impl<S> Stream for OpenAiResponsesSseBridgeStream<S>
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
                self.state.buffer.push_str(text);
                let bridged = bridge_sse_buffer(&mut self.state);
                if bridged.is_empty() {
                    Poll::Pending
                } else {
                    Poll::Ready(Some(Ok(Bytes::from(bridged))))
                }
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                e.to_string(),
            )))),
            Poll::Ready(None) => {
                let tail = finalize_bridge(&mut self.state);
                if tail.is_empty() {
                    Poll::Ready(None)
                } else {
                    Poll::Ready(Some(Ok(Bytes::from(tail))))
                }
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_chunk_emits_created_delta_completed() {
        let mut state = ResponsesBridgeState::default();
        let event = "data: {\"id\":\"chatcmpl_1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-5.4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"},\"finish_reason\":null}]}\n\n\
                     data: {\"id\":\"chatcmpl_1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-5.4\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
        state.buffer.push_str(event);
        let output = bridge_sse_buffer(&mut state);
        assert!(output.contains("event: response.created"));
        assert!(output.contains("event: response.output_text.delta"));
        assert!(output.contains("\"delta\":\"Hi\""));
        assert!(output.contains("event: response.completed"));
    }

    #[test]
    fn test_done_event_triggers_completion() {
        let mut state = ResponsesBridgeState::default();
        let event = "data: {\"id\":\"chatcmpl_2\",\"object\":\"chat.completion.chunk\",\"created\":456,\"model\":\"gpt-5.4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n\
                     data: [DONE]\n\n";
        state.buffer.push_str(event);
        let output = bridge_sse_buffer(&mut state);
        assert!(output.contains("event: response.output_text.done"));
        assert!(output.contains("event: response.completed"));
    }

    #[test]
    fn test_finalize_without_done_still_completes() {
        let mut state = ResponsesBridgeState::default();
        state.buffer.push_str("data: {\"id\":\"chatcmpl_3\",\"object\":\"chat.completion.chunk\",\"created\":789,\"model\":\"gpt-5.4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"A\"},\"finish_reason\":null}]}\n");
        let output = finalize_bridge(&mut state);
        assert!(output.contains("event: response.completed"));
    }
}
