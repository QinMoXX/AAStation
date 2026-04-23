use crate::store::AppState;
use tauri::State;

/// Configure Claude Code to use the local proxy.
///
/// Writes `~/.claude/settings.json` and `~/.claude.json` with the proxy URL
/// and auth token. The auth token is the AAStation proxy auth token used for
/// request verification — it is NOT forwarded to upstream providers.
/// Original config files are backed up as `*.aastation-backup` before modification.
#[tauri::command]
pub async fn configure_claude_code(
    state: State<'_, AppState>,
    proxy_url: String,
) -> Result<(), String> {
    let auth_token = state.proxy_auth_token.read().await.clone();
    crate::claude_config::configure_claude_code(&proxy_url, &auth_token)
        .map_err(|e| e.to_string())
}

/// Check whether Claude Code is already configured by AAStation.
///
/// Returns `true` if `~/.claude/settings.json` exists and contains
/// all AAStation-managed keys.
#[tauri::command]
pub async fn is_claude_configured() -> Result<bool, String> {
    crate::claude_config::is_claude_configured().map_err(|e| e.to_string())
}

/// Remove Claude Code proxy configuration.
///
/// Removes the AAStation-managed keys from `~/.claude/settings.json`.
#[tauri::command]
pub async fn unconfigure_claude_code() -> Result<(), String> {
    crate::claude_config::unconfigure_claude_code().map_err(|e| e.to_string())
}

/// Restore Claude Code configuration from backup files.
///
/// If `*.aastation-backup` files exist, they are restored to the original paths.
#[tauri::command]
pub async fn restore_claude_config() -> Result<(), String> {
    crate::claude_config::restore_claude_config().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// OpenCode app configuration commands
// ---------------------------------------------------------------------------

/// Configure OpenCode to use the local AAStation proxy.
///
/// Writes `~/.config/opencode/config.json` (Windows: `%APPDATA%\opencode\config.json`)
/// with the proxy URL and auth token under `provider.aastation`.
/// Original config is backed up as `*.aastation-backup` before modification.
#[tauri::command]
pub async fn configure_open_code(
    state: State<'_, AppState>,
    proxy_url: String,
) -> Result<(), String> {
    let auth_token = state.proxy_auth_token.read().await.clone();
    crate::opencode_config::configure_open_code(&proxy_url, &auth_token)
        .map_err(|e| e.to_string())
}

/// Check whether OpenCode is already configured by AAStation.
///
/// Returns `true` if the config file exists and contains `provider.aastation.options.baseURL`.
#[tauri::command]
pub async fn is_open_code_configured() -> Result<bool, String> {
    crate::opencode_config::is_open_code_configured().map_err(|e| e.to_string())
}

/// Remove the AAStation-managed `provider.aastation` entry from OpenCode config.
#[tauri::command]
pub async fn unconfigure_open_code() -> Result<(), String> {
    crate::opencode_config::unconfigure_open_code().map_err(|e| e.to_string())
}

/// Restore OpenCode config from the `.aastation-backup` backup file.
#[tauri::command]
pub async fn restore_open_code_config() -> Result<(), String> {
    crate::opencode_config::restore_open_code_config().map_err(|e| e.to_string())
}
