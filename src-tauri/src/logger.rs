#![allow(dead_code, unused_imports)]

use std::path::PathBuf;
use std::sync::Mutex;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

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

/// Global storage for the log guard so that the panic handler can flush logs
/// even when the normal drop order is bypassed during a panic.
static LOG_GUARD: Mutex<Option<tracing_appender::non_blocking::WorkerGuard>> = Mutex::new(None);

/// Initialize the logging system with both console and file output.
///
/// Returns a `LogGuard` that must be kept alive for the entire application lifetime.
/// When dropped (normal exit, Ctrl+C, or panic), all buffered log entries are flushed to disk.
pub fn init() -> Result<LogGuard, String> {
    let log_dir = log_dir_path()?;
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
