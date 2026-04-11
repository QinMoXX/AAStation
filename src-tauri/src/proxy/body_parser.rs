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
}
