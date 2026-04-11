use thiserror::Error;

/// Unified error type for the application.
/// All Tauri commands return `Result<T, AppError>` which implements `Into<String>`
/// via the `Serialize` derive required by Tauri's command system.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Proxy error: {0}")]
    Proxy(String),

    #[error("DAG error: {0}")]
    Dag(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<AppError> for String {
    fn from(err: AppError) -> String {
        err.to_string()
    }
}
