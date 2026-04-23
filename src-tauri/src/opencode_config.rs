use serde_json::Value;
use std::path::PathBuf;

use crate::error::AppError;

/// The key AAStation uses inside the `provider` object of OpenCode config.
const AASTATION_PROVIDER_KEY: &str = "aastation";

/// Suffix appended to config files when creating backups.
const BACKUP_SUFFIX: &str = ".aastation-backup";

/// Cross-platform home directory resolution.
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

/// Get the path to OpenCode's config file.
///
/// - Windows/macOS/Linux: `~/.config/opencode/opencode.json`
fn opencode_config_path() -> Result<PathBuf, AppError> {
    // Prefer XDG_CONFIG_HOME when available, otherwise use ~/.config.
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        return Ok(PathBuf::from(xdg).join("opencode").join("opencode.json"));
    }

    let home = dirs_home_dir()?;
    Ok(home.join(".config").join("opencode").join("opencode.json"))
}

/// Configure OpenCode to use the local AAStation proxy.
///
/// Writes (or merges) `~/.config/opencode/opencode.json` so that the
/// `provider.aastation` entry points at the local proxy URL and uses the
/// proxy auth token as its API key.
///
/// Only the `provider.aastation` key is touched; all other user configuration
/// is preserved.  A `.aastation-backup` is created before the first write.
pub fn configure_open_code(proxy_url: &str, auth_token: &str) -> Result<(), AppError> {
    let config_path = opencode_config_path()?;

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Read existing config or start fresh
    let mut root: Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        backup_file(&config_path)?;
        serde_json::from_str(&content).unwrap_or(Value::Object(serde_json::Map::new()))
    } else {
        Value::Object(serde_json::Map::new())
    };

    // Ensure root is an object
    if !root.is_object() {
        root = Value::Object(serde_json::Map::new());
    }

    // Build the aastation provider entry
    let provider_entry = serde_json::json!({
        "npm": "@ai-sdk/openai-compatible",
        "name": "AAStation",
        "options": {
            "apiKey": auth_token,
            "baseURL": proxy_url
        },
        "models": {
            "High": { "name": "High" },
            "Medium": { "name": "Medium" },
            "Low": { "name": "Low" }
        }
    });

    // Insert / update root["provider"]["aastation"]
    let provider_map = root
        .as_object_mut()
        .unwrap()
        .entry("provider")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));

    if !provider_map.is_object() {
        *provider_map = Value::Object(serde_json::Map::new());
    }

    provider_map
        .as_object_mut()
        .unwrap()
        .insert(AASTATION_PROVIDER_KEY.to_string(), provider_entry);

    atomic_write_json(&config_path, &root)?;

    Ok(())
}

/// Remove the AAStation-managed `provider.aastation` entry from OpenCode config.
///
/// Preserves all other user configuration.
pub fn unconfigure_open_code() -> Result<(), AppError> {
    let config_path = opencode_config_path()?;

    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)?;
    let mut root: Value =
        serde_json::from_str(&content).unwrap_or(Value::Object(serde_json::Map::new()));

    if let Some(provider_map) = root.get_mut("provider").and_then(|v| v.as_object_mut()) {
        provider_map.remove(AASTATION_PROVIDER_KEY);
    }

    atomic_write_json(&config_path, &root)?;

    Ok(())
}

/// Check whether OpenCode is already configured by AAStation.
///
/// Returns `true` if the config file exists and contains a non-empty
/// `provider.aastation.options.baseURL` value.
pub fn is_open_code_configured() -> Result<bool, AppError> {
    let config_path = opencode_config_path()?;

    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&config_path)?;
    let root: Value =
        serde_json::from_str(&content).unwrap_or(Value::Object(serde_json::Map::new()));

    let configured = root
        .get("provider")
        .and_then(|p| p.get(AASTATION_PROVIDER_KEY))
        .and_then(|e| e.get("options"))
        .and_then(|o| o.get("baseURL"))
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    Ok(configured)
}

/// Restore OpenCode config from the `.aastation-backup` backup file.
pub fn restore_open_code_config() -> Result<(), AppError> {
    let config_path = opencode_config_path()?;

    if backup_path(&config_path).exists() {
        restore_file(&config_path)?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn backup_path(path: &PathBuf) -> PathBuf {
    let mut p = path.clone();
    let mut name = p.file_name().map(|n| n.to_owned()).unwrap_or_default();
    name.push(BACKUP_SUFFIX);
    p.set_file_name(name);
    p
}

fn backup_file(path: &PathBuf) -> Result<(), AppError> {
    let bk = backup_path(path);
    if !bk.exists() && path.exists() {
        std::fs::copy(path, &bk)?;
    }
    Ok(())
}

fn restore_file(path: &PathBuf) -> Result<(), AppError> {
    let bk = backup_path(path);
    if bk.exists() {
        std::fs::copy(&bk, path)?;
        std::fs::remove_file(&bk)?;
    }
    Ok(())
}

fn atomic_write_json<T: serde::Serialize>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(data)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
