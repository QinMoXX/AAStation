use std::path::PathBuf;

use crate::error::AppError;

/// The provider key AAStation inserts into the Codex `model_providers` table.
const AASTATION_PROVIDER_KEY: &str = "aastation";

/// The profile key AAStation inserts into the Codex `profiles` table.
const AASTATION_PROFILE_KEY: &str = "aastation";

/// Suffix appended to config files when creating backups.
const BACKUP_SUFFIX: &str = ".aastation-backup";

/// The environment variable key written to `auth.json` for Codex CLI authentication.
/// Codex reads this when `requires_openai_auth = true` is set in the provider config.
const CODEX_AUTH_KEY: &str = "OPENAI_API_KEY";

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
/// - `[model_providers.aastation]` points at the local proxy URL using the
///   proxy auth token as the API key, with `wire_api = "responses"` (OpenAI Responses API
///   compatible — used by Codex CLI).
/// - `[profiles.aastation]` selects the `aastation` provider.
///
/// Only the `model_providers.aastation` and `profiles.aastation` keys are
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

    // -------------------------------------------------------------------------
    // [model_providers.aastation]
    // -------------------------------------------------------------------------
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
        entry["name"] = toml_edit::value("AAStation Proxy");
        entry["base_url"] = toml_edit::value(proxy_url);
        entry["env_key"] = toml_edit::value(CODEX_AUTH_KEY);
        entry["wire_api"] = toml_edit::value("responses");
        entry["requires_openai_auth"] = toml_edit::value(true);

        providers[AASTATION_PROVIDER_KEY] = toml_edit::Item::Table(entry);
    }

    // -------------------------------------------------------------------------
    // [profiles.aastation]
    // -------------------------------------------------------------------------
    {
        // Ensure [profiles] table exists
        if !doc.contains_key("profiles") {
            doc["profiles"] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        let profiles = doc["profiles"]
            .as_table_mut()
            .ok_or_else(|| AppError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "profiles is not a TOML table",
            )))?;

        let mut profile = toml_edit::Table::new();
        profile["model_provider"] = toml_edit::value(AASTATION_PROVIDER_KEY);

        profiles[AASTATION_PROFILE_KEY] = toml_edit::Item::Table(profile);
    }

    // Write TOML file and persist auth token as environment variable hint
    atomic_write_toml(&config_path, &doc)?;

    // Write a small env-file next to the config so the user can source it,
    // or the UI can display the value.  The proxy uses requires_openai_auth=true
    // so Codex will read AASTATION_API_KEY (or OPENAI_API_KEY) from the env.
    // We store the mapping in a sidecar file for reference.
    let env_hint_path = config_path
        .parent()
        .unwrap_or(&config_path)
        .join("aastation_env.txt");
    let env_content = format!(
        "# Set this environment variable before running: codex --profile aastation\nAASTATION_API_KEY={}\n",
        auth_token
    );
    std::fs::write(&env_hint_path, &env_content)?;

    // -------------------------------------------------------------------------
    // ~/.codex/auth.json — write OPENAI_API_KEY so Codex CLI picks it up via
    // `requires_openai_auth = true` in the provider config.
    // Matches the lingyaai default scheme: auth.json = { "OPENAI_API_KEY": "..." }
    // -------------------------------------------------------------------------
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
    let auth_content = serde_json::to_string_pretty(&serde_json::Value::Object(auth_obj))
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    std::fs::write(&auth_path, &auth_content)?;

    Ok(())
}

/// Remove the AAStation-managed entries from Codex CLI config.
///
/// Removes `model_providers.aastation` and `profiles.aastation` from
/// `~/.codex/config.toml`.  Preserves all other user configuration.
pub fn unconfigure_codex_cli() -> Result<(), AppError> {
    let config_path = codex_config_path()?;

    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)?;
    let mut doc: toml_edit::DocumentMut = content.parse().unwrap_or_default();

    // Remove model_providers.aastation
    if let Some(providers) = doc.get_mut("model_providers").and_then(|v| v.as_table_mut()) {
        providers.remove(AASTATION_PROVIDER_KEY);
    }

    // Remove profiles.aastation
    if let Some(profiles) = doc.get_mut("profiles").and_then(|v| v.as_table_mut()) {
        profiles.remove(AASTATION_PROFILE_KEY);
    }

    atomic_write_toml(&config_path, &doc)?;

    // Remove the env hint sidecar if present
    let env_hint_path = config_path
        .parent()
        .unwrap_or(&config_path)
        .join("aastation_env.txt");
    if env_hint_path.exists() {
        let _ = std::fs::remove_file(&env_hint_path);
    }

    // Remove OPENAI_API_KEY from ~/.codex/auth.json.
    // Only remove the key AAStation manages; preserve any other keys the user may have.
    // If the resulting object is empty, delete the file entirely.
    let auth_path = codex_auth_path()?;
    if auth_path.exists() {
        let content = std::fs::read_to_string(&auth_path)?;
        let mut auth_obj: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&content).unwrap_or_default();
        auth_obj.remove(CODEX_AUTH_KEY);
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
/// `model_providers.aastation.base_url`, AND `~/.codex/auth.json` exists
/// and contains the `OPENAI_API_KEY` entry.
pub fn is_codex_cli_configured() -> Result<bool, AppError> {
    let config_path = codex_config_path()?;

    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&config_path)?;
    let doc: toml_edit::DocumentMut = content.parse().unwrap_or_default();

    let toml_configured = doc
        .get("model_providers")
        .and_then(|v| v.as_table())
        .and_then(|t| t.get(AASTATION_PROVIDER_KEY))
        .and_then(|v| v.as_table())
        .and_then(|t| t.get("base_url"))
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if !toml_configured {
        return Ok(false);
    }

    // Also verify auth.json has the key
    let auth_path = codex_auth_path()?;
    if !auth_path.exists() {
        return Ok(false);
    }
    let auth_content = std::fs::read_to_string(&auth_path)?;
    let auth_obj: serde_json::Value = serde_json::from_str(&auth_content).unwrap_or_default();
    let auth_configured = auth_obj
        .get(CODEX_AUTH_KEY)
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    Ok(auth_configured)
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
