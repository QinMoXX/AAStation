use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::SystemTime;

const LOG_DIR: &str = "logs";
const DEFAULT_MAX_BYTES: usize = 64 * 1024;
const MAX_ALLOWED_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct LogRuntimeStatus {
    pub backend_local_read_write: bool,
    pub mode: String,
    pub log_dir: String,
    pub active_file: Option<String>,
    pub note: String,
    /// Total size of all log files in bytes.
    pub dir_size_bytes: u64,
    /// Maximum allowed total size in bytes (from logger config).
    pub dir_max_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct LogPollRequest {
    pub file_name: Option<String>,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct LogPollResponse {
    pub backend_local_read_write: bool,
    pub mode: String,
    pub file_name: Option<String>,
    pub next_offset: u64,
    pub rotated: bool,
    pub truncated: bool,
    pub lines: Vec<String>,
}

#[derive(Debug)]
struct LatestLogFile {
    path: PathBuf,
    name: String,
}

fn log_dir_path() -> Result<PathBuf, String> {
    let paths = crate::paths::init().map_err(|e| e.to_string())?;
    let dir = paths.state_dir.join(LOG_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create log directory: {}", e))?;
    Ok(dir)
}

/// Returns the total size in bytes of all log files in the directory.
fn log_dir_size(log_dir: &PathBuf) -> u64 {
    let Ok(entries) = fs::read_dir(log_dir) else { return 0; };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            if !p.is_file() { return false; }
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
            ext == "txt" || ext == "log"
        })
        .filter_map(|e| e.metadata().ok().map(|m| m.len()))
        .sum()
}

fn newest_log_file(log_dir: &PathBuf) -> Result<Option<LatestLogFile>, String> {
    let entries = fs::read_dir(log_dir).map_err(|e| format!("Failed to read log directory: {}", e))?;
    let mut latest: Option<(PathBuf, String, SystemTime)> = None;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or_default();
        if ext != "txt" && ext != "log" {
            continue;
        }

        let file_name = match path.file_name().and_then(|x| x.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &latest {
            Some((_, _, current_modified)) if *current_modified >= modified => {}
            _ => latest = Some((path, file_name, modified)),
        }
    }

    Ok(latest.map(|(path, name, _)| LatestLogFile { path, name }))
}

#[tauri::command]
pub async fn get_log_runtime_status() -> Result<LogRuntimeStatus, String> {
    let log_dir = log_dir_path()?;
    let latest = newest_log_file(&log_dir)?;
    let dir_size_bytes = log_dir_size(&log_dir);

    // Read the user-configured limit from settings; fall back to the default.
    let dir_max_bytes = crate::settings::load_settings()
        .map(|s| s.log_dir_max_mb.max(1) * 1024 * 1024)
        .unwrap_or(crate::logger::LOG_DIR_DEFAULT_MAX_BYTES);

    Ok(LogRuntimeStatus {
        backend_local_read_write: true,
        mode: "backend_local".to_string(),
        log_dir: log_dir.to_string_lossy().to_string(),
        active_file: latest.map(|f| f.name),
        note: "日志写入与读取均由后端本地文件系统完成，前端仅通过 IPC 拉取当前日志文件末尾窗口内容。".to_string(),
        dir_size_bytes,
        dir_max_bytes,
    })
}

#[tauri::command]
pub async fn poll_runtime_logs(request: Option<LogPollRequest>) -> Result<LogPollResponse, String> {
    let log_dir = log_dir_path()?;
    let latest = newest_log_file(&log_dir)?;

    let Some(latest_file) = latest else {
        return Ok(LogPollResponse {
            backend_local_read_write: true,
            mode: "backend_local".to_string(),
            file_name: None,
            next_offset: 0,
            rotated: false,
            truncated: false,
            lines: vec![],
        });
    };

    let req = request.unwrap_or(LogPollRequest {
        file_name: None,
        max_bytes: None,
    });
    let max_bytes = req
        .max_bytes
        .unwrap_or(DEFAULT_MAX_BYTES)
        .max(1024)
        .min(MAX_ALLOWED_BYTES);

    let metadata = fs::metadata(&latest_file.path)
        .map_err(|e| format!("Failed to read log file metadata: {}", e))?;
    let file_size = metadata.len();

    let rotated = req
        .file_name
        .as_ref()
        .map(|name| name != &latest_file.name)
        .unwrap_or(false);

    // The runtime log viewer always tracks the tail of the active file so the
    // UI consistently shows the newest content instead of accumulating history.
    let start_offset = file_size.saturating_sub(max_bytes as u64);
    let truncated = start_offset > 0;

    let mut file = File::open(&latest_file.path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|e| format!("Failed to seek log file: {}", e))?;

    let mut buffer = vec![0u8; max_bytes];
    let read_bytes = file
        .read(&mut buffer)
        .map_err(|e| format!("Failed to read log file: {}", e))?;
    buffer.truncate(read_bytes);

    let next_offset = start_offset + read_bytes as u64;

    let text = String::from_utf8_lossy(&buffer);
    let mut lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
    if !text.ends_with('\n') && !lines.is_empty() {
        // The last line may be partial while the logger is writing it.
        lines.pop();
    }

    Ok(LogPollResponse {
        backend_local_read_write: true,
        mode: "backend_local".to_string(),
        file_name: Some(latest_file.name),
        next_offset,
        rotated,
        truncated,
        lines,
    })
}

/// Open the log directory in the system file explorer.
///
/// Uses the `tauri-plugin-opener` shell-open facility which is already
/// bundled in this application.  On Windows this calls `explorer.exe`,
/// on macOS `open`, on Linux `xdg-open`.
#[tauri::command]
pub async fn open_log_dir() -> Result<(), String> {
    let log_dir = log_dir_path()?;
    let path_str = log_dir.to_string_lossy().to_string();

    // open::that is re-exported via the opener plugin's underlying library.
    // We use std::process::Command for maximum compatibility and to avoid
    // needing an additional AppHandle parameter here.
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {}", e))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {}", e))?;
    }

    Ok(())
}
