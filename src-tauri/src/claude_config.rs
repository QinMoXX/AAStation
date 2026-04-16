#![allow(dead_code, unused_imports)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::AppError;

/// Claude Code settings file: `~/.claude/settings.json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSettings {
    #[serde(default)]
    pub env: HashMap<String, serde_json::Value>,
}

/// Claude Code onboarding file: `~/.claude.json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeOnboarding {
    #[serde(default)]
    pub has_completed_onboarding: bool,
}

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
/// 1. `~/.claude/settings.json` — sets `ANTHROPIC_BASE_URL` and other env vars
/// 2. `~/.claude.json` — sets `hasCompletedOnboarding: true`
///
/// API Key is NOT set here — it is provided by the Provider node during proxy forwarding.
/// If the files already exist, they are merged (existing keys are preserved, our keys are updated).
pub fn configure_claude_code(proxy_url: &str) -> Result<(), AppError> {
    // --- Write ~/.claude/settings.json ---
    let settings_path = claude_settings_path()?;

    // Ensure ~/.claude/ directory exists
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Read existing settings or create new
    let mut settings: ClaudeSettings = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(ClaudeSettings {
            env: HashMap::new(),
        })
    } else {
        ClaudeSettings {
            env: HashMap::new(),
        }
    };

    // Set the proxy URL — this is the only required setting for AAStation
    settings.env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        serde_json::Value::String(proxy_url.to_string()),
    );

    // Set timeout
    settings.env.insert(
        "API_TIMEOUT_MS".to_string(),
        serde_json::Value::String("3000000".to_string()),
    );

    // Disable non-essential traffic
    settings.env.insert(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
        serde_json::Value::Number(1.into()),
    );

    // Write settings (atomic)
    let tmp_path = settings_path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, &settings_path)?;

    // --- Write ~/.claude.json ---
    let onboarding_path = claude_onboarding_path()?;

    let mut onboarding: ClaudeOnboarding = if onboarding_path.exists() {
        let content = std::fs::read_to_string(&onboarding_path)?;
        serde_json::from_str(&content).unwrap_or(ClaudeOnboarding {
            has_completed_onboarding: false,
        })
    } else {
        ClaudeOnboarding {
            has_completed_onboarding: false,
        }
    };

    onboarding.has_completed_onboarding = true;

    // Write onboarding (atomic)
    let tmp_path = onboarding_path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&onboarding)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, &onboarding_path)?;

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
    });

    let keys_to_remove = [
        "ANTHROPIC_BASE_URL",
        "API_TIMEOUT_MS",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ];

    for key in &keys_to_remove {
        settings.env.remove(*key);
    }

    // Write settings (atomic)
    let tmp_path = settings_path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, &settings_path)?;

    Ok(())
}
