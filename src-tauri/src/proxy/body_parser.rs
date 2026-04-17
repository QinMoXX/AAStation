#![allow(dead_code, unused_imports)]

use super::types::{ApiType, RequestProtocol};

/// Extract the `model` field from a JSON request body.
///
/// Returns `None` if the body is not valid JSON or the `model` field is absent.
/// This is used for model-based routing decisions.
pub fn extract_model(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("model")?.as_str().map(|s| s.to_string()))
}

/// Replace the `model` field in a JSON request body with a new value.
///
/// Returns the modified body if the `model` field exists and was replaced.
/// Returns `None` if the body is not valid JSON or no modification was needed.
pub fn replace_model(body: &[u8], new_model: &str) -> Option<Vec<u8>> {
    if new_model.is_empty() {
        return None;
    }

    let mut value: serde_json::Value = serde_json::from_slice(body).ok()?;
    if value.get("model").is_some() {
        value["model"] = serde_json::Value::String(new_model.to_string());
        serde_json::to_vec(&value).ok()
    } else {
        None
    }
}

/// Detect the request protocol style from the request path.
///
/// - `/v1/messages` → Anthropic
/// - `/v1/chat/completions` → OpenAI
/// - Other paths → defaults to OpenAI
pub fn detect_request_protocol(path: &str) -> RequestProtocol {
    let trimmed = path.trim_end_matches('/');
    if trimmed == "/v1/messages" || trimmed.starts_with("/v1/messages/") {
        RequestProtocol::Anthropic
    } else {
        // Default to OpenAI for /v1/chat/completions and any other path
        RequestProtocol::OpenAI
    }
}

/// Adapt the request body from the client's protocol style to the upstream provider's protocol style.
///
/// Conversion rules:
/// - OpenAI → Anthropic: move "max_tokens" (if absent, default 4096), ensure body has Anthropic fields
/// - Anthropic → OpenAI: remove Anthropic-specific fields ("max_tokens" becomes top-level, remove "metadata")
/// - Same protocol: no conversion needed (only model replacement if target_model is set)
///
/// Also handles model replacement if `target_model` is non-empty.
///
/// Returns the adapted body bytes.
pub fn adapt_request_body(
    body: &[u8],
    source_protocol: RequestProtocol,
    target_api_type: ApiType,
    target_model: &str,
) -> Vec<u8> {
    let mut value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => {
            // Not valid JSON — return as-is (only do model replacement if possible)
            if !target_model.is_empty() {
                return replace_model(body, target_model).unwrap_or_else(|| body.to_vec());
            }
            return body.to_vec();
        }
    };

    // Model replacement
    if !target_model.is_empty() && value.get("model").is_some() {
        value["model"] = serde_json::Value::String(target_model.to_string());
    }

    // Protocol adaptation
    match (source_protocol, target_api_type) {
        // OpenAI → Anthropic: ensure max_tokens exists
        (RequestProtocol::OpenAI, ApiType::Anthropic) => {
            // Anthropic requires max_tokens
            if value.get("max_tokens").is_none() {
                value["max_tokens"] = serde_json::Value::Number(
                    serde_json::Number::from(4096),
                );
            }
            // Remove OpenAI-specific fields that Anthropic doesn't understand
            if let Some(obj) = value.as_object_mut() {
                obj.remove("frequency_penalty");
                obj.remove("presence_penalty");
                obj.remove("logprobs");
                obj.remove("top_logprobs");
                obj.remove("n");
                obj.remove("stop");
                // "stream" is valid in both, keep it
                // "temperature" and "top_p" are valid in both, keep them
            }
        }

        // Anthropic → OpenAI: remove Anthropic-specific fields
        (RequestProtocol::Anthropic, ApiType::OpenAI) => {
            if let Some(obj) = value.as_object_mut() {
                // "max_tokens" in Anthropic is not the same as OpenAI's.
                // OpenAI uses "max_tokens" too (for completions), but it's not required.
                // Keep max_tokens as-is since OpenAI also supports it.
                // Remove Anthropic-specific fields
                obj.remove("metadata");
                obj.remove("system"); // Anthropic system prompt field — not in OpenAI format
                // Note: we keep "messages" as-is since both formats use it similarly
                // (though Anthropic uses content blocks, most simple text messages are compatible)
            }
        }

        // Same protocol → no conversion needed (model replacement already done above)
        (RequestProtocol::OpenAI, ApiType::OpenAI)
        | (RequestProtocol::Anthropic, ApiType::Anthropic) => {}
    }

    serde_json::to_vec(&value).unwrap_or_else(|_| body.to_vec())
}

/// Compute the upstream request path based on the provider's API type.
///
/// The local proxy accepts two standard paths:
/// - `/v1/chat/completions` (OpenAI style)
/// - `/v1/messages` (Anthropic style)
///
/// When forwarding, we compute the correct endpoint path for the target API type.
/// The upstream URL is constructed as: `base_url + adapted_path`
///
/// Since `base_url` in the Provider config may already include a path prefix
/// (e.g. `https://open.bigmodel.cn/api/paas/v4`), we only append the
/// endpoint-specific suffix, not the full `/v1/...` prefix.
///
/// Path mapping:
/// - OpenAI-style endpoint: `/chat/completions`
/// - Anthropic-style endpoint: `/messages`
///
/// For non-standard paths (neither /v1/chat/completions nor /v1/messages),
/// we pass them through as-is.
pub fn adapt_request_path(original_path: &str, target_api_type: ApiType) -> String {
    // Handle query strings
    let (path, query) = if let Some((p, q)) = original_path.split_once('?') {
        (p, Some(q))
    } else {
        (original_path, None)
    };

    let trimmed = path.trim_end_matches('/');

    let new_path = match target_api_type {
        ApiType::OpenAI => {
            // Map any chat-style request to OpenAI endpoint suffix
            if trimmed == "/v1/chat/completions"
                || trimmed == "/v1/messages"
            {
                "/chat/completions".to_string()
            } else if trimmed == "/v1/models" {
                "/models".to_string()
            } else if trimmed.starts_with("/v1/") {
                // Strip /v1 prefix for other OpenAI paths
                trimmed[3..].to_string()
            } else {
                path.to_string()
            }
        }
        ApiType::Anthropic => {
            // Map any chat-style request to Anthropic endpoint suffix
            if trimmed == "/v1/messages"
                || trimmed == "/v1/chat/completions"
            {
                "/messages".to_string()
            } else if trimmed.starts_with("/v1/") {
                // Strip /v1 prefix for other Anthropic paths
                trimmed[3..].to_string()
            } else {
                path.to_string()
            }
        }
    };

    match query {
        Some(q) => format!("{}?{}", new_path, q),
        None => new_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_model_present() {
        let body = br#"{"model":"claude-sonnet-4-20250514","messages":[]}"#;
        assert_eq!(
            extract_model(body),
            Some("claude-sonnet-4-20250514".to_string())
        );
    }

    #[test]
    fn test_extract_model_missing() {
        let body = br#"{"messages":[]}"#;
        assert_eq!(extract_model(body), None);
    }

    #[test]
    fn test_extract_model_null() {
        let body = br#"{"model":null}"#;
        assert_eq!(extract_model(body), None);
    }

    #[test]
    fn test_extract_model_invalid_json() {
        let body = b"not json at all";
        assert_eq!(extract_model(body), None);
    }

    #[test]
    fn test_extract_model_empty_body() {
        let body = b"";
        assert_eq!(extract_model(body), None);
    }

    #[test]
    fn test_replace_model_basic() {
        let body = br#"{"model":"old-model","messages":[]}"#;
        let result = replace_model(body, "new-model");
        assert!(result.is_some());
        let new_body = result.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&new_body).unwrap()["model"],
            "new-model"
        );
    }

    #[test]
    fn test_replace_model_empty_new_model() {
        let body = br#"{"model":"old-model","messages":[]}"#;
        let result = replace_model(body, "");
        assert!(result.is_none());
    }

    #[test]
    fn test_replace_model_no_model_field() {
        let body = br#"{"messages":[]}"#;
        let result = replace_model(body, "new-model");
        assert!(result.is_none());
    }

    #[test]
    fn test_replace_model_invalid_json() {
        let body = b"not json";
        let result = replace_model(body, "new-model");
        assert!(result.is_none());
    }

    #[test]
    fn test_replace_model_preserves_other_fields() {
        let body = br#"{"model":"old","messages":[{"role":"user","content":"hi"}],"stream":true}"#;
        let result = replace_model(body, "new-model");
        assert!(result.is_some());
        let new_body = result.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&new_body).unwrap();
        assert_eq!(v["model"], "new-model");
        assert_eq!(v["messages"][0]["role"], "user");
        assert_eq!(v["stream"], true);
    }

    // --- Protocol detection tests ---

    #[test]
    fn test_detect_openai_protocol() {
        assert_eq!(detect_request_protocol("/v1/chat/completions"), RequestProtocol::OpenAI);
        assert_eq!(detect_request_protocol("/v1/chat/completions?stream=true"), RequestProtocol::OpenAI);
        assert_eq!(detect_request_protocol("/v1/engines"), RequestProtocol::OpenAI);
        assert_eq!(detect_request_protocol("/api/paas/v4/chat/completions"), RequestProtocol::OpenAI);
    }

    #[test]
    fn test_detect_anthropic_protocol() {
        assert_eq!(detect_request_protocol("/v1/messages"), RequestProtocol::Anthropic);
        assert_eq!(detect_request_protocol("/v1/messages/"), RequestProtocol::Anthropic);
        assert_eq!(detect_request_protocol("/v1/messages/msg_123"), RequestProtocol::Anthropic);
    }

    // --- Path adaptation tests ---

    #[test]
    fn test_adapt_path_openai_to_openai() {
        assert_eq!(
            adapt_request_path("/v1/chat/completions", ApiType::OpenAI),
            "/chat/completions"
        );
    }

    #[test]
    fn test_adapt_path_anthropic_to_openai() {
        assert_eq!(
            adapt_request_path("/v1/messages", ApiType::OpenAI),
            "/chat/completions"
        );
    }

    #[test]
    fn test_adapt_path_openai_to_anthropic() {
        assert_eq!(
            adapt_request_path("/v1/chat/completions", ApiType::Anthropic),
            "/messages"
        );
    }

    #[test]
    fn test_adapt_path_anthropic_to_anthropic() {
        assert_eq!(
            adapt_request_path("/v1/messages", ApiType::Anthropic),
            "/messages"
        );
    }

    #[test]
    fn test_adapt_path_with_query_string() {
        assert_eq!(
            adapt_request_path("/v1/chat/completions?stream=true", ApiType::OpenAI),
            "/chat/completions?stream=true"
        );
    }

    #[test]
    fn test_adapt_path_v1_models() {
        assert_eq!(
            adapt_request_path("/v1/models", ApiType::OpenAI),
            "/models"
        );
    }

    #[test]
    fn test_adapt_path_other_v1_path() {
        assert_eq!(
            adapt_request_path("/v1/embeddings", ApiType::OpenAI),
            "/embeddings"
        );
    }

    // --- Body adaptation tests ---

    #[test]
    fn test_adapt_body_openai_to_anthropic_adds_max_tokens() {
        let body = br#"{"model":"claude-sonnet-4","messages":[{"role":"user","content":"hi"}]}"#;
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::Anthropic, "");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(v["max_tokens"], 4096);
        assert_eq!(v["model"], "claude-sonnet-4");
    }

    #[test]
    fn test_adapt_body_openai_to_anthropic_preserves_existing_max_tokens() {
        let body = br#"{"model":"claude-sonnet-4","messages":[],"max_tokens":2048}"#;
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::Anthropic, "");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(v["max_tokens"], 2048);
    }

    #[test]
    fn test_adapt_body_openai_to_anthropic_removes_openai_fields() {
        let body = br#"{"model":"claude-sonnet-4","messages":[],"frequency_penalty":0.5,"n":3,"stop":["end"]}"#;
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::Anthropic, "");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert!(v.get("frequency_penalty").is_none());
        assert!(v.get("n").is_none());
        assert!(v.get("stop").is_none());
    }

    #[test]
    fn test_adapt_body_anthropic_to_openai_removes_metadata() {
        let body = br#"{"model":"gpt-4o","messages":[],"max_tokens":1024,"metadata":{"user_id":"123"},"system":"You are helpful"}"#;
        let result = adapt_request_body(body, RequestProtocol::Anthropic, ApiType::OpenAI, "");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert!(v.get("metadata").is_none());
        assert!(v.get("system").is_none());
        // max_tokens should be preserved since OpenAI also supports it
        assert_eq!(v["max_tokens"], 1024);
    }

    #[test]
    fn test_adapt_body_same_protocol_no_changes() {
        let body = br#"{"model":"gpt-4o","messages":[],"stream":true}"#;
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::OpenAI, "");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(v["model"], "gpt-4o");
        assert_eq!(v["stream"], true);
    }

    #[test]
    fn test_adapt_body_with_model_replacement() {
        let body = br#"{"model":"claude-sonnet-4","messages":[]}"#;
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::OpenAI, "gpt-4o");
        let v: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(v["model"], "gpt-4o");
    }

    #[test]
    fn test_adapt_body_invalid_json_passthrough() {
        let body = b"not json";
        let result = adapt_request_body(body, RequestProtocol::OpenAI, ApiType::Anthropic, "");
        assert_eq!(result, b"not json");
    }
}
