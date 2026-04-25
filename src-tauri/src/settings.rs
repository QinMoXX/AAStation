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
    /// Port range for proxy listeners (e.g. "9527-9530" or "9527" for a single port).
    /// Each Application node gets its own port from this range.
    #[serde(default = "default_port_range")]
    pub listen_port_range: String,
    /// Address the proxy binds to (default "127.0.0.1").
    pub listen_address: String,
    /// Unique auth token for proxy access verification.
    /// Generated on first run, stored persistently. Read-only in UI.
    /// Used by client apps (e.g. Claude Code) to authenticate with the proxy.
    /// NOT used for upstream forwarding — Provider node API keys are used instead.
    #[serde(default = "generate_auth_token")]
    pub proxy_auth_token: String,
    /// Maximum total size of log files in MB (default 500).
    /// Oldest log files are deleted on startup when the total exceeds this limit.
    #[serde(default = "default_log_dir_max_mb")]
    pub log_dir_max_mb: u64,
    /// Whether the app should start automatically when the OS starts.
    #[serde(default)]
    pub launch_at_startup: bool,
}

fn default_port_range() -> String {
    "9527-9537".to_string()
}

fn default_log_dir_max_mb() -> u64 {
    500
}

/// Parse a port range string into a (start, end) pair.
/// "9527" → (9527, 9527), "9527-9537" → (9527, 9537)
pub fn parse_port_range(range: &str) -> Result<(u16, u16), String> {
    let trimmed = range.trim();
    if let Some((start_str, end_str)) = trimmed.split_once('-') {
        let start: u16 = start_str.trim().parse().map_err(|_| format!("Invalid port range: {}", range))?;
        let end: u16 = end_str.trim().parse().map_err(|_| format!("Invalid port range: {}", range))?;
        if start == 0 || end == 0 {
            return Err(format!("Port cannot be 0: {}", range));
        }
        if start > end {
            return Err(format!("Start port {} > end port {}", start, end));
        }
        Ok((start, end))
    } else {
        let port: u16 = trimmed.parse().map_err(|_| format!("Invalid port range: {}", range))?;
        if port == 0 {
            return Err(format!("Port cannot be 0: {}", range));
        }
        Ok((port, port))
    }
}

/// Collect all ports currently in use by Application nodes from the DAG.
/// Used to determine which ports are available for new Application nodes.
pub fn used_ports_from_dag(doc: &crate::dag::types::DAGDocument) -> Vec<u16> {
    let mut ports = Vec::new();
    for node in &doc.nodes {
        if node.node_type == crate::dag::types::NodeType::Application {
            if let Ok(data) = serde_json::from_value::<crate::dag::types::ApplicationNodeData>(node.data.clone()) {
                if data.listen_port > 0 {
                    ports.push(data.listen_port);
                }
            }
        }
    }
    ports.sort();
    ports.dedup();
    ports
}

/// Find the next available port from the range, excluding already-used ports.
pub fn find_available_port(range: &str, used_ports: &[u16]) -> Result<u16, String> {
    let (start, end) = parse_port_range(range)?;
    let used_set: std::collections::HashSet<u16> = used_ports.iter().copied().collect();
    for port in start..=end {
        if !used_set.contains(&port) {
            return Ok(port);
        }
    }
    Err(format!("No available port in range {} (all {} ports in use)", range, end - start + 1))
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
            listen_port_range: default_port_range(),
            listen_address: "127.0.0.1".to_string(),
            proxy_auth_token: generate_auth_token(),
            log_dir_max_mb: default_log_dir_max_mb(),
            launch_at_startup: false,
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
/// Migrates old `listen_port` field to `listen_port_range` if needed.
pub fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    
    // Handle migration from listen_port to listen_port_range
    // The old format had "listen_port" instead of "listen_port_range"
    let migrated_content = if let Ok(mut raw) = serde_json::from_str::<serde_json::Value>(&content) {
        if raw.get("listen_port").is_some() && raw.get("listen_port_range").is_none() {
            if let Some(port) = raw.get("listen_port").and_then(|v| v.as_u64()) {
                raw.as_object_mut().map(|obj| {
                    obj.insert(
                        "listen_port_range".to_string(),
                        serde_json::Value::String(format!("{}-{}", port, port + 10)),
                    );
                    obj.remove("listen_port");
                });
            }
            serde_json::to_string(&raw).unwrap_or(content.clone())
        } else {
            content.clone()
        }
    } else {
        content.clone()
    };
    
    let mut settings: AppSettings = serde_json::from_str(&migrated_content)?;
    
    // Ensure auth token exists (for configs created before this field was added)
    if settings.proxy_auth_token.is_empty() {
        settings.proxy_auth_token = generate_auth_token();
        // Persist the generated token (and migrated settings)
        save_settings(&settings)?;
    } else if migrated_content != content {
        // Persist migrated settings
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
