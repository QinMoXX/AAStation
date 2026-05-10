use serde::Serialize;

fn launch_at_startup_supported() -> bool {
    cfg!(target_os = "windows") || cfg!(target_os = "linux")
}

#[derive(Debug, Serialize)]
pub struct PlatformCapabilities {
    pub launch_at_startup_supported: bool,
}

#[derive(Debug, Serialize)]
pub struct RuntimePaths {
    pub config_dir: String,
    pub data_dir: String,
    pub state_dir: String,
    pub logs_dir: String,
}

#[derive(Debug, Serialize)]
pub struct PlatformInfo {
    pub platform: String,
    pub capabilities: PlatformCapabilities,
    pub paths: RuntimePaths,
}

#[tauri::command]
pub async fn get_platform_info() -> Result<PlatformInfo, String> {
    let paths = crate::paths::init().map_err(|e| e.to_string())?;
    let logs_dir = paths.state_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);

    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
    .to_string();

    Ok(PlatformInfo {
        platform,
        capabilities: PlatformCapabilities {
            launch_at_startup_supported: launch_at_startup_supported(),
        },
        paths: RuntimePaths {
            config_dir: paths.config_dir.to_string_lossy().to_string(),
            data_dir: paths.data_dir.to_string_lossy().to_string(),
            state_dir: paths.state_dir.to_string_lossy().to_string(),
            logs_dir: logs_dir.to_string_lossy().to_string(),
        },
    })
}
