#![allow(dead_code, unused_imports)]

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
