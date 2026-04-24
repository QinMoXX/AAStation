use std::path::PathBuf;

use crate::error::AppError;

/// The provider key AAStation inserts into the Codex `model_providers` table.
const AASTATION_PROVIDER_KEY: &str = "aastation";

/// Suffix appended to config files when creating backups.
const BACKUP_SUFFIX: &str = ".aastation-backup";

/// The authentication key written to `auth.json` for Codex CLI authentication.
const CODEX_AUTH_KEY: &str = "OPENAI_API_KEY";
const CODEX_AUTH_MODE_KEY: &str = "auth_mode";
const CODEX_AUTH_MODE_VALUE: &str = "apikey";

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

/// Get the path to Codex CLI's config file: `~/.codex/config.toml`
fn codex_config_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(".codex").join("config.toml"))
}

/// Get the path to Codex CLI's auth file: `~/.codex/auth.json`
fn codex_auth_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(".codex").join("auth.json"))
}

/// Configure Codex CLI to use the local AAStation proxy.
///
/// Writes (or merges) `~/.codex/config.toml` so that:
/// - Root keys select the `aastation` provider/model and API-key auth mode.
/// - `[model_providers.aastation]` points at the local proxy URL with `wire_api = "responses"`.
///
/// Only AAStation-managed keys are
/// touched; all other user configuration is preserved.
/// A `.aastation-backup` is created before the first write.
pub fn configure_codex_cli(proxy_url: &str, auth_token: &str) -> Result<(), AppError> {
    let config_path = codex_config_path()?;

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Read existing TOML or start with an empty document
    let mut doc: toml_edit::DocumentMut = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        backup_file(&config_path)?;
        content.parse().unwrap_or_default()
    } else {
        toml_edit::DocumentMut::new()
    };

    // Root keys
    doc["model_provider"] = toml_edit::value(AASTATION_PROVIDER_KEY);
    doc["model"] = toml_edit::value("gpt-5.4");
    doc["model_reasoning_effort"] = toml_edit::value("high");
    doc["disable_response_storage"] = toml_edit::value(true);
    doc["preferred_auth_method"] = toml_edit::value(CODEX_AUTH_MODE_VALUE);

    // [model_providers.aastation]
    {
        // Ensure [model_providers] table exists
        if !doc.contains_key("model_providers") {
            doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        let providers = doc["model_providers"]
            .as_table_mut()
            .ok_or_else(|| AppError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "model_providers is not a TOML table",
            )))?;

        let mut entry = toml_edit::Table::new();
        entry["name"] = toml_edit::value("aastation");
        entry["base_url"] = toml_edit::value(proxy_url);
        entry["wire_api"] = toml_edit::value("responses");

        providers[AASTATION_PROVIDER_KEY] = toml_edit::Item::Table(entry);
    }

    // Write TOML file
    atomic_write_toml(&config_path, &doc)?;

    // ~/.codex/auth.json — write OPENAI_API_KEY and auth_mode.
    let auth_path = codex_auth_path()?;
    if auth_path.exists() {
        backup_file(&auth_path)?;
    }
    let mut auth_obj: serde_json::Map<String, serde_json::Value> = if auth_path.exists() {
        let content = std::fs::read_to_string(&auth_path)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    auth_obj.insert(
        CODEX_AUTH_KEY.to_string(),
        serde_json::Value::String(auth_token.to_string()),
    );
    auth_obj.insert(
        CODEX_AUTH_MODE_KEY.to_string(),
        serde_json::Value::String(CODEX_AUTH_MODE_VALUE.to_string()),
    );
    let auth_content = serde_json::to_string_pretty(&serde_json::Value::Object(auth_obj))
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    std::fs::write(&auth_path, &auth_content)?;

    Ok(())
}

/// Remove the AAStation-managed entries from Codex CLI config.
///
/// Removes AAStation-managed root keys and `model_providers.aastation` from
/// `~/.codex/config.toml`.  Preserves all other user configuration.
pub fn unconfigure_codex_cli() -> Result<(), AppError> {
    let config_path = codex_config_path()?;

    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)?;
    let mut doc: toml_edit::DocumentMut = content.parse().unwrap_or_default();

    // Remove root keys managed by AAStation
    doc.as_table_mut().remove("model_provider");
    doc.as_table_mut().remove("model");
    doc.as_table_mut().remove("model_reasoning_effort");
    doc.as_table_mut().remove("disable_response_storage");
    doc.as_table_mut().remove("preferred_auth_method");

    // Remove model_providers.aastation
    if let Some(providers) = doc.get_mut("model_providers").and_then(|v| v.as_table_mut()) {
        providers.remove(AASTATION_PROVIDER_KEY);
        if providers.is_empty() {
            doc.as_table_mut().remove("model_providers");
        }
    }

    atomic_write_toml(&config_path, &doc)?;

    // Remove OPENAI_API_KEY/auth_mode from ~/.codex/auth.json.
    // Only remove the key AAStation manages; preserve any other keys the user may have.
    // If the resulting object is empty, delete the file entirely.
    let auth_path = codex_auth_path()?;
    if auth_path.exists() {
        let content = std::fs::read_to_string(&auth_path)?;
        let mut auth_obj: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&content).unwrap_or_default();
        auth_obj.remove(CODEX_AUTH_KEY);
        auth_obj.remove(CODEX_AUTH_MODE_KEY);
        if auth_obj.is_empty() {
            let _ = std::fs::remove_file(&auth_path);
        } else {
            let updated = serde_json::to_string_pretty(&serde_json::Value::Object(auth_obj))
                .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
            std::fs::write(&auth_path, &updated)?;
        }
    }

    Ok(())
}

/// Check whether Codex CLI is already configured by AAStation.
///
/// Returns `true` if `~/.codex/config.toml` exists and contains
/// expected AAStation keys, AND `~/.codex/auth.json` exists and contains
/// `OPENAI_API_KEY` + `auth_mode = "apikey"`.
pub fn is_codex_cli_configured() -> Result<bool, AppError> {
    let config_path = codex_config_path()?;

    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&config_path)?;
    let doc: toml_edit::DocumentMut = content.parse().unwrap_or_default();

    let provider_ok = doc
        .get("model_provider")
        .and_then(|v| v.as_str())
        .map(|s| s == AASTATION_PROVIDER_KEY)
        .unwrap_or(false);
    let model_ok = doc
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s == "gpt-5.4")
        .unwrap_or(false);
    let effort_ok = doc
        .get("model_reasoning_effort")
        .and_then(|v| v.as_str())
        .map(|s| s == "high")
        .unwrap_or(false);
    let storage_ok = doc
        .get("disable_response_storage")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let auth_method_ok = doc
        .get("preferred_auth_method")
        .and_then(|v| v.as_str())
        .map(|s| s == CODEX_AUTH_MODE_VALUE)
        .unwrap_or(false);
    let base_url_ok = doc
        .get("model_providers")
        .and_then(|v| v.as_table())
        .and_then(|t| t.get(AASTATION_PROVIDER_KEY))
        .and_then(|v| v.as_table())
        .and_then(|t| t.get("base_url"))
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if !(provider_ok && model_ok && effort_ok && storage_ok && auth_method_ok && base_url_ok) {
        return Ok(false);
    }

    // Also verify auth.json has the key
    let auth_path = codex_auth_path()?;
    if !auth_path.exists() {
        return Ok(false);
    }
    let auth_content = std::fs::read_to_string(&auth_path)?;
    let auth_obj: serde_json::Value = serde_json::from_str(&auth_content).unwrap_or_default();
    let auth_key_ok = auth_obj
        .get(CODEX_AUTH_KEY)
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let auth_mode_ok = auth_obj
        .get(CODEX_AUTH_MODE_KEY)
        .and_then(|v| v.as_str())
        .map(|s| s == CODEX_AUTH_MODE_VALUE)
        .unwrap_or(false);

    Ok(auth_key_ok && auth_mode_ok)
}

/// Restore Codex CLI config from the `.aastation-backup` backup file.
pub fn restore_codex_cli_config() -> Result<(), AppError> {
    let config_path = codex_config_path()?;

    if backup_path(&config_path).exists() {
        restore_file(&config_path)?;
    }

    // Also restore auth.json from backup if present
    let auth_path = codex_auth_path()?;
    if backup_path(&auth_path).exists() {
        restore_file(&auth_path)?;
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

fn atomic_write_toml(path: &PathBuf, doc: &toml_edit::DocumentMut) -> Result<(), AppError> {
    let tmp_path = path.with_extension("toml.tmp");
    let content = doc.to_string();
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
