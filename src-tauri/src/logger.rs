#![allow(dead_code, unused_imports)]

use std::path::PathBuf;
use std::sync::Mutex;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Default maximum total size of all log files in the log directory (500 MB).
/// The actual limit is read from user settings at startup and passed to `init()`.
pub const LOG_DIR_DEFAULT_MAX_BYTES: u64 = 500 * 1024 * 1024;

/// Directory for log files under the app data directory.
const LOG_DIR: &str = "logs";

/// Returns the path to the log directory: `~/.aastation/logs/`
fn log_dir_path() -> Result<PathBuf, String> {
    let home = dirs_home_dir()?;
    let dir = home.join(".aastation").join(LOG_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create log directory: {}", e))?;
    Ok(dir)
}

/// Cross-platform home directory resolution.
fn dirs_home_dir() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(p));
    }
    if let (Some(drive), Some(path)) = (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        let mut buf = PathBuf::from(drive);
        buf.push(path);
        return Ok(buf);
    }
    Err("Cannot determine home directory".to_string())
}

/// Generates a log file name based on the current time.
/// Format: `2026-04-19_14-30-00.txt`
fn log_file_name() -> String {
    let now = chrono::Local::now();
    format!("{}.txt", now.format("%Y-%m-%d_%H-%M-%S"))
}

/// Remove the oldest log files until the total directory size is within `max_bytes`.
///
/// Files are deleted in ascending modification-time order (oldest first). The
/// currently-being-written file is excluded from deletion because it is not yet
/// closed, but since we only keep it after trimming older files there should
/// almost always be enough headroom.
///
/// Silent on any individual deletion failure — a best-effort cleanup is still
/// better than aborting the whole startup sequence.
pub fn cleanup_old_logs(log_dir: &PathBuf, max_bytes: u64) {
    // Collect (modified_time, path, size) for every .txt / .log file.
    let entries = match std::fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut files: Vec<(std::time::SystemTime, PathBuf, u64)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            if !p.is_file() { return false; }
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
            ext == "txt" || ext == "log"
        })
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let size = meta.len();
            Some((modified, e.path(), size))
        })
        .collect();

    // Sort oldest first.
    files.sort_by_key(|(t, _, _)| *t);

    let total: u64 = files.iter().map(|(_, _, s)| s).sum();
    if total <= max_bytes {
        return; // Nothing to do.
    }

    let mut freed: u64 = 0;
    let to_free = total - max_bytes;

    // Never delete the newest file (last in sorted list).
    let deletable_count = files.len().saturating_sub(1);

    for (_, path, size) in files.iter().take(deletable_count) {
        if freed >= to_free {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            freed += size;
        }
    }
}

/// Global storage for the log guard so that the panic handler can flush logs
/// even when the normal drop order is bypassed during a panic.
static LOG_GUARD: Mutex<Option<tracing_appender::non_blocking::WorkerGuard>> = Mutex::new(None);

/// Initialize the logging system with both console and file output.
///
/// `max_log_dir_bytes` controls the total log directory size cap; oldest files
/// are pruned before the new log file is created.  Pass `LOG_DIR_DEFAULT_MAX_BYTES`
/// when no user-configured value is available.
///
/// Returns a `LogGuard` that must be kept alive for the entire application lifetime.
/// When dropped (normal exit, Ctrl+C, or panic), all buffered log entries are flushed to disk.
pub fn init(max_log_dir_bytes: u64) -> Result<LogGuard, String> {
    let log_dir = log_dir_path()?;

    // Clean up old logs before opening the new log file so we do not
    // accidentally count the file we are about to create.
    cleanup_old_logs(&log_dir, max_log_dir_bytes);

    let file_name = log_file_name();

    let file_appender = tracing_appender::rolling::never(log_dir, &file_name);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_ansi(true);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    // Store the guard globally so the panic handler can drop it to flush
    {
        let mut g = LOG_GUARD.lock().unwrap();
        *g = Some(guard);
    }

    // Install a panic hook that flushes logs before the process aborts
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("Application panicked: {}", info);
        // Flush log buffer by dropping the guard
        if let Ok(mut g) = LOG_GUARD.lock() {
            *g = None;
        }
        // Invoke the original hook (prints backtrace, etc.)
        default_hook(info);
    }));

    tracing::info!("Logger initialized. Log file: {}", file_name);

    Ok(LogGuard)
}

/// Zero-sized marker type. The actual `WorkerGuard` is stored in a global static
/// so that the panic handler can access it. This struct exists solely to provide
/// a RAII token that the caller keeps alive for the application's lifetime.
pub struct LogGuard;

impl Drop for LogGuard {
    fn drop(&mut self) {
        // Flush remaining log entries by dropping the worker guard
        if let Ok(mut g) = LOG_GUARD.lock() {
            *g = None;
        }
    }
}
