#![allow(dead_code, unused_imports)]

use axum::http::HeaderMap;

use super::error::ProxyError;
use super::types::{CompiledRoute, MatchType};

/// Match an incoming request against the route table.
///
/// Priority order: path_prefix → header → model, then fall back to the default route.
pub fn match_route<'a>(
    routes: &'a [CompiledRoute],
    default_route: &'a Option<CompiledRoute>,
    path: &str,
    headers: &HeaderMap,
    model: Option<&str>,
) -> Result<&'a CompiledRoute, ProxyError> {
    // 1. Try path_prefix matches
    for route in routes {
        if matches!(route.match_type, MatchType::PathPrefix) && path.starts_with(&route.pattern) {
            return Ok(route);
        }
    }

    // 2. Try header matches (pattern format: "Header-Name:value")
    for route in routes {
        if matches!(route.match_type, MatchType::Header) {
            if let Some((header_name, header_value)) = route.pattern.split_once(':') {
                if headers
                    .get(header_name)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v == header_value)
                    .unwrap_or(false)
                {
                    return Ok(route);
                }
            }
        }
    }

    // 3. Try model matches
    if let Some(req_model) = model {
        for route in routes {
            if matches!(route.match_type, MatchType::Model) {
                let matched = if route.fuzzy_match {
                    req_model.contains(&route.pattern)
                } else {
                    route.pattern == req_model
                };
                if matched {
                    return Ok(route);
                }
            }
        }
    }

    // 4. Fall back to default route
    if let Some(ref route) = default_route {
        return Ok(route);
    }

    Err(ProxyError::NoMatch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderName, HeaderValue};
    use std::collections::HashMap;

    fn make_route(id: &str, match_type: MatchType, pattern: &str) -> CompiledRoute {
        CompiledRoute {
            id: id.to_string(),
            match_type,
            pattern: pattern.to_string(),
            upstream_url: "https://upstream.example.com".to_string(),
            anthropic_upstream_url: None,
            api_key: "test-key".to_string(),
            extra_headers: HashMap::new(),
            is_default: false,
            api_type: None,
            target_model: String::new(),
            fuzzy_match: false,
        }
    }

    fn make_default_route(id: &str) -> CompiledRoute {
        CompiledRoute {
            id: id.to_string(),
            match_type: MatchType::PathPrefix,
            pattern: String::new(),
            upstream_url: "https://default.example.com".to_string(),
            anthropic_upstream_url: None,
            api_key: "default-key".to_string(),
            extra_headers: HashMap::new(),
            is_default: true,
            api_type: None,
            target_model: String::new(),
            fuzzy_match: false,
        }
    }

    #[test]
    fn test_path_prefix_match() {
        let routes = vec![make_route("r1", MatchType::PathPrefix, "/v1/messages")];
        let default = None;
        let headers = HeaderMap::new();

        let result = match_route(&routes, &default, "/v1/messages/123", &headers, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "r1");
    }

    #[test]
    fn test_path_prefix_no_match() {
        let routes = vec![make_route("r1", MatchType::PathPrefix, "/v1/messages")];
        let default = None;
        let headers = HeaderMap::new();

        let result = match_route(&routes, &default, "/v2/chat", &headers, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_header_match() {
        let routes = vec![make_route("r2", MatchType::Header, "X-Custom:value123")];
        let default = None;
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("value123"),
        );

        let result = match_route(&routes, &default, "/any/path", &headers, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "r2");
    }

    #[test]
    fn test_header_no_match() {
        let routes = vec![make_route("r2", MatchType::Header, "X-Custom:value123")];
        let default = None;
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("wrong"),
        );

        let result = match_route(&routes, &default, "/any/path", &headers, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_model_match() {
        let routes = vec![make_route("r3", MatchType::Model, "claude-sonnet-4-20250514")];
        let default = None;
        let headers = HeaderMap::new();

        let result = match_route(
            &routes,
            &default,
            "/v1/messages",
            &headers,
            Some("claude-sonnet-4-20250514"),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "r3");
    }

    #[test]
    fn test_model_no_match() {
        let routes = vec![make_route("r3", MatchType::Model, "claude-sonnet-4-20250514")];
        let default = None;
        let headers = HeaderMap::new();

        let result = match_route(&routes, &default, "/v1/messages", &headers, Some("gpt-4o"));
        assert!(result.is_err());
    }

    #[test]
    fn test_priority_path_over_header() {
        let routes = vec![
            make_route("r-header", MatchType::Header, "X-Flag:yes"),
            make_route("r-path", MatchType::PathPrefix, "/v1"),
        ];
        let default = None;
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-flag"),
            HeaderValue::from_static("yes"),
        );

        let result = match_route(&routes, &default, "/v1/messages", &headers, None);
        assert!(result.is_ok());
        // path_prefix has higher priority
        assert_eq!(result.unwrap().id, "r-path");
    }

    #[test]
    fn test_priority_header_over_model() {
        let routes = vec![
            make_route("r-model", MatchType::Model, "gpt-4o"),
            make_route("r-header", MatchType::Header, "X-Flag:yes"),
        ];
        let default = None;
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-flag"),
            HeaderValue::from_static("yes"),
        );

        let result = match_route(
            &routes,
            &default,
            "/v1/chat",
            &headers,
            Some("gpt-4o"),
        );
        assert!(result.is_ok());
        // header has higher priority than model
        assert_eq!(result.unwrap().id, "r-header");
    }

    #[test]
    fn test_default_route_fallback() {
        let routes = vec![make_route("r1", MatchType::PathPrefix, "/specific")];
        let default = Some(make_default_route("default"));

        let headers = HeaderMap::new();
        let result = match_route(&routes, &default, "/other/path", &headers, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "default");
    }

    #[test]
    fn test_no_match_no_default() {
        let routes = vec![make_route("r1", MatchType::PathPrefix, "/specific")];
        let default = None;
        let headers = HeaderMap::new();

        let result = match_route(&routes, &default, "/other/path", &headers, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_model_fuzzy_match_substring() {
        let mut route = make_route("r1", MatchType::Model, "claude-haiku");
        route.fuzzy_match = true;
        let routes = vec![route];
        let default = None;
        let headers = HeaderMap::new();

        // "claude-haiku-4-5-20251001" contains "claude-haiku" → match
        let result = match_route(&routes, &default, "/v1/messages", &headers, Some("claude-haiku-4-5-20251001"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "r1");
    }

    #[test]
    fn test_model_fuzzy_match_exact_still_works() {
        let mut route = make_route("r1", MatchType::Model, "claude-haiku");
        route.fuzzy_match = true;
        let routes = vec![route];
        let default = None;
        let headers = HeaderMap::new();

        // Exact match with fuzzy_match enabled should still work
        let result = match_route(&routes, &default, "/v1/messages", &headers, Some("claude-haiku"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "r1");
    }

    #[test]
    fn test_model_fuzzy_match_no_match() {
        let mut route = make_route("r1", MatchType::Model, "claude-haiku");
        route.fuzzy_match = true;
        let routes = vec![route];
        let default = None;
        let headers = HeaderMap::new();

        // "gpt-4o" does not contain "claude-haiku" → no match
        let result = match_route(&routes, &default, "/v1/messages", &headers, Some("gpt-4o"));
        assert!(result.is_err());
    }

    #[test]
    fn test_model_exact_match_no_fuzzy() {
        let routes = vec![make_route("r1", MatchType::Model, "claude-haiku")];
        let default = None;
        let headers = HeaderMap::new();

        // Without fuzzy_match, substring is not enough → no match
        let result = match_route(&routes, &default, "/v1/messages", &headers, Some("claude-haiku-4-5-20251001"));
        assert!(result.is_err());
    }
}
