use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AppError;

/// Default directory name under the home directory.
const APP_DIR: &str = ".aastation";
/// Settings file name.
const SETTINGS_FILE: &str = "settings.json";

/// Application settings persisted to ~/.aastation/settings.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Port the proxy listens on (default 9527).
    pub listen_port: u16,
    /// Address the proxy binds to (default "127.0.0.1").
    pub listen_address: String,
    /// Unique auth token for proxy access verification.
    /// Generated on first run, stored persistently. Read-only in UI.
    /// Used by client apps (e.g. Claude Code) to authenticate with the proxy.
    /// NOT used for upstream forwarding — Provider node API keys are used instead.
    #[serde(default = "generate_auth_token")]
    pub proxy_auth_token: String,
}

pub fn generate_auth_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    format!("aast_{:016x}{:016x}", seed, rand_value(seed))
}

/// Simple deterministic pseudo-random value for token generation.
fn rand_value(seed: u64) -> u64 {
    // xorshift64
    let mut x = seed.wrapping_add(0x9e3779b97f4a7c15);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
            proxy_auth_token: generate_auth_token(),
        }
    }
}

/// Cross-platform home directory resolution (same as dag_store).
fn dirs_home_dir() -> Result<PathBuf, AppError> {
    if let Some(p) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(p));
    }
    if let (Some(drive), Some(path)) = (
        std::env::var_os("HOMEDRIVE"),
        std::env::var_os("HOMEPATH"),
    ) {
        let mut buf = PathBuf::from(drive);
        buf.push(path);
        return Ok(buf);
    }
    Err(AppError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "Cannot determine home directory",
    )))
}

/// Get the path to the settings file: ~/.aastation/settings.json
fn settings_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(APP_DIR).join(SETTINGS_FILE))
}

/// Load settings from disk. Returns default settings if file doesn't exist.
/// Ensures `proxy_auth_token` is always present (generates one if missing from old configs).
pub fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    let mut settings: AppSettings = serde_json::from_str(&content)?;
    // Ensure auth token exists (for configs created before this field was added)
    if settings.proxy_auth_token.is_empty() {
        settings.proxy_auth_token = generate_auth_token();
        // Persist the generated token
        save_settings(&settings)?;
    }
    Ok(settings)
}

/// Save settings to disk atomically.
pub fn save_settings(settings: &AppSettings) -> Result<(), AppError> {
    let path = settings_path()?;

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Atomic write: write to .tmp then rename
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(settings)?;

    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, &path)?;

    Ok(())
}
