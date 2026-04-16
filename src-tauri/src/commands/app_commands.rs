#![allow(dead_code, unused_imports)]

use crate::store::AppState;
use tauri::State;

/// Configure Claude Code to use the local proxy.
///
/// Writes `~/.claude/settings.json` and `~/.claude.json` with the proxy URL.
/// API key is not set here — it is provided by the Provider node during proxy forwarding.
#[tauri::command]
pub async fn configure_claude_code(
    _state: State<'_, AppState>,
    proxy_url: String,
) -> Result<(), String> {
    crate::claude_config::configure_claude_code(&proxy_url)
        .map_err(|e| e.to_string())
}

/// Remove Claude Code proxy configuration.
///
/// Removes the AAStation-managed keys from `~/.claude/settings.json`.
#[tauri::command]
pub async fn unconfigure_claude_code() -> Result<(), String> {
    crate::claude_config::unconfigure_claude_code().map_err(|e| e.to_string())
}
