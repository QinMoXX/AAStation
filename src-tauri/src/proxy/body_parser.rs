#![allow(dead_code, unused_imports)]

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
}
