use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

/// Errors that can occur within the proxy engine.
#[derive(Debug, Error)]
pub enum ProxyError {
    #[error("Proxy is already running on port {0}")]
    AlreadyRunning(u16),

    #[error("Proxy is not running")]
    NotRunning,

    #[error("No route table loaded — publish a DAG first")]
    NoRouteTable,

    #[error("Route match failed: no matching route and no default")]
    NoMatch,

    #[error("Token budget exceeded: provider '{0}' has reached its configured token limit")]
    TokenBudgetExceeded(String),

    #[error("Upstream request failed: {0}")]
    UpstreamError(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Failed to bind to {0}: {1}")]
    BindFailed(String, String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] http::Error),
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ProxyError::AlreadyRunning(_) => (StatusCode::CONFLICT, self.to_string()),
            ProxyError::NotRunning => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            ProxyError::NoRouteTable => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            ProxyError::NoMatch => (StatusCode::BAD_GATEWAY, self.to_string()),
            ProxyError::TokenBudgetExceeded(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
            ProxyError::UpstreamError(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
            ProxyError::InvalidConfig(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            ProxyError::BindFailed(_, _) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            ProxyError::Io(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            ProxyError::Http(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, message).into_response()
    }
}

impl From<ProxyError> for String {
    fn from(err: ProxyError) -> String {
        err.to_string()
    }
}
