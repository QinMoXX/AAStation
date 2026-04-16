#![allow(dead_code, unused_imports)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::AppError;

/// Claude Code settings file: `~/.claude/settings.json`
///
/// We parse the full JSON as a `serde_json::Value` so that any keys we don't
/// know about (e.g. `permissions`, `allowedTools`, etc.) are preserved when we
/// write the file back.  We only touch the `env` sub-object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSettings {
    /// The raw JSON object — we keep all fields intact.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
    /// Environment variables set by Claude Code.
    #[serde(default)]
    pub env: HashMap<String, Value>,
}

/// Claude Code onboarding file: `~/.claude.json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeOnboarding {
    #[serde(default)]
    pub has_completed_onboarding: bool,
    /// Catch any other fields so they are preserved.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// Keys that AAStation manages inside the `env` object of `settings.json`.
const AASTATION_MANAGED_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
];

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

/// Get path to `~/.claude/settings.json`
fn claude_settings_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(".claude").join("settings.json"))
}

/// Get path to `~/.claude.json`
fn claude_onboarding_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(".claude.json"))
}

/// Configure Claude Code to use the local proxy.
///
/// This writes two files:
/// 1. `~/.claude/settings.json` — sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and other env vars
/// 2. `~/.claude.json` — sets `hasCompletedOnboarding: true`
///
/// The `ANTHROPIC_AUTH_TOKEN` is the AAStation proxy auth token — it is used only for
/// authenticating with the local proxy. The proxy will NOT forward this token to upstream;
/// instead it uses the Provider node's API key for upstream authentication.
///
/// If the files already exist, they are merged (existing keys are preserved, our keys are updated).
/// A backup of the original file is saved as `<filename>.aastation-backup` before any modification.
pub fn configure_claude_code(proxy_url: &str, auth_token: &str) -> Result<(), AppError> {
    // --- Write ~/.claude/settings.json ---
    let settings_path = claude_settings_path()?;

    // Ensure ~/.claude/ directory exists
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Read existing settings or create new
    let mut settings: ClaudeSettings = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        // Backup the original file before we modify it
        backup_file(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(ClaudeSettings {
            env: HashMap::new(),
            extra: HashMap::new(),
        })
    } else {
        ClaudeSettings {
            env: HashMap::new(),
            extra: HashMap::new(),
        }
    };

    // Set the proxy URL — this is the only required setting for AAStation
    settings.env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        Value::String(proxy_url.to_string()),
    );

    // Set the AAStation proxy auth token — used by Claude Code to authenticate
    // with the local proxy. NOT forwarded to upstream (Provider key is used instead).
    settings.env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        Value::String(auth_token.to_string()),
    );

    // Set timeout
    settings.env.insert(
        "API_TIMEOUT_MS".to_string(),
        Value::String("3000000".to_string()),
    );

    // Disable non-essential traffic
    settings.env.insert(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
        Value::Number(1.into()),
    );

    // Write settings (atomic)
    atomic_write_json(&settings_path, &settings)?;

    // --- Write ~/.claude.json ---
    let onboarding_path = claude_onboarding_path()?;

    let mut onboarding: ClaudeOnboarding = if onboarding_path.exists() {
        let content = std::fs::read_to_string(&onboarding_path)?;
        // Backup the original file before we modify it
        backup_file(&onboarding_path)?;
        serde_json::from_str(&content).unwrap_or(ClaudeOnboarding {
            has_completed_onboarding: false,
            extra: HashMap::new(),
        })
    } else {
        ClaudeOnboarding {
            has_completed_onboarding: false,
            extra: HashMap::new(),
        }
    };

    onboarding.has_completed_onboarding = true;

    // Write onboarding (atomic)
    atomic_write_json(&onboarding_path, &onboarding)?;

    Ok(())
}

/// Remove Claude Code proxy configuration.
///
/// Removes `ANTHROPIC_BASE_URL`, `API_TIMEOUT_MS`,
/// and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` from the settings file.
/// Preserves other settings the user may have configured.
pub fn unconfigure_claude_code() -> Result<(), AppError> {
    let settings_path = claude_settings_path()?;

    if !settings_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&settings_path)?;
    let mut settings: ClaudeSettings = serde_json::from_str(&content).unwrap_or(ClaudeSettings {
        env: HashMap::new(),
        extra: HashMap::new(),
    });

    for key in AASTATION_MANAGED_KEYS {
        settings.env.remove(*key);
    }

    // Write settings (atomic)
    atomic_write_json(&settings_path, &settings)?;

    Ok(())
}

/// Restore Claude Code configuration from backup files.
///
/// If a `.aastation-backup` file exists for either config file, it is
/// restored (copied back to the original path).
pub fn restore_claude_config() -> Result<(), AppError> {
    let settings_path = claude_settings_path()?;
    let onboarding_path = claude_onboarding_path()?;

    if backup_path(&settings_path).exists() {
        restore_file(&settings_path)?;
    }

    if backup_path(&onboarding_path).exists() {
        restore_file(&onboarding_path)?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Compute the backup path for a given file path.
fn backup_path(path: &PathBuf) -> PathBuf {
    let mut p = path.clone();
    let mut name = p.file_name().map(|n| n.to_owned()).unwrap_or_default();
    name.push(BACKUP_SUFFIX);
    p.set_file_name(name);
    p
}

/// Create a backup of the file at `path` as `<path>.aastation-backup`.
///
/// Only creates a backup if one does not already exist (so the original
/// pre-AAStation content is always preserved even across multiple configure calls).
fn backup_file(path: &PathBuf) -> Result<(), AppError> {
    let bk = backup_path(path);
    if !bk.exists() && path.exists() {
        std::fs::copy(path, &bk)?;
    }
    Ok(())
}

/// Restore a file from its `.aastation-backup` backup, then remove the backup.
fn restore_file(path: &PathBuf) -> Result<(), AppError> {
    let bk = backup_path(path);
    if bk.exists() {
        std::fs::copy(&bk, path)?;
        std::fs::remove_file(&bk)?;
    }
    Ok(())
}

/// Atomically write a serializable value as pretty-printed JSON.
fn atomic_write_json<T: Serialize>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(data)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
