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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            listen_port: 9527,
            listen_address: "127.0.0.1".to_string(),
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
pub fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    let settings: AppSettings = serde_json::from_str(&content)?;
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
