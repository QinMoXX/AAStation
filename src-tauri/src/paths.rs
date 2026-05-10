use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::error::AppError;

const APP_LEGACY_DIR_NAME: &str = ".aastation";
#[cfg(target_os = "linux")]
const APP_XDG_DIR_NAME: &str = "aastation";

#[cfg(target_os = "linux")]
const MIGRATION_MARKER_FILE: &str = "migrated-from-legacy-v1";

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub legacy_dir: PathBuf,
    pub using_legacy: bool,
}

static PATHS: OnceLock<AppPaths> = OnceLock::new();

pub fn init() -> Result<&'static AppPaths, AppError> {
    if let Some(paths) = PATHS.get() {
        return Ok(paths);
    }

    let resolved = resolve_paths_with_migration()?;
    Ok(PATHS.get_or_init(|| resolved))
}

fn resolve_paths_with_migration() -> Result<AppPaths, AppError> {
    let home = home_dir()?;
    let legacy_dir = home.join(APP_LEGACY_DIR_NAME);

    #[cfg(target_os = "linux")]
    {
        let config_dir = xdg_config_home(&home)?.join(APP_XDG_DIR_NAME);
        let data_dir = xdg_data_home(&home)?.join(APP_XDG_DIR_NAME);
        let state_dir = xdg_state_home(&home)?.join(APP_XDG_DIR_NAME);

        if let Err(err) = ensure_dirs(&[&config_dir, &data_dir, &state_dir]) {
            tracing::warn!(
                error = %err,
                "无法创建 XDG 目录，回退使用旧目录"
            );
            ensure_dirs(&[&legacy_dir])?;
            return Ok(AppPaths {
                config_dir: legacy_dir.clone(),
                data_dir: legacy_dir.clone(),
                state_dir: legacy_dir.clone(),
                legacy_dir,
                using_legacy: true,
            });
        }

        let marker_path = config_dir.join(MIGRATION_MARKER_FILE);
        if !marker_path.exists() {
            match migrate_legacy_to_xdg(&legacy_dir, &config_dir, &data_dir, &state_dir) {
                Ok(()) => {
                    if let Err(err) = write_marker(&marker_path) {
                        tracing::warn!(error = %err, "写入迁移标记失败");
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        "旧目录迁移失败，回退使用旧目录且不阻断启动"
                    );
                    ensure_dirs(&[&legacy_dir])?;
                    return Ok(AppPaths {
                        config_dir: legacy_dir.clone(),
                        data_dir: legacy_dir.clone(),
                        state_dir: legacy_dir.clone(),
                        legacy_dir,
                        using_legacy: true,
                    });
                }
            }
        }

        Ok(AppPaths {
            config_dir,
            data_dir,
            state_dir,
            legacy_dir,
            using_legacy: false,
        })
    }

    #[cfg(not(target_os = "linux"))]
    {
        ensure_dirs(&[&legacy_dir])?;
        Ok(AppPaths {
            config_dir: legacy_dir.clone(),
            data_dir: legacy_dir.clone(),
            state_dir: legacy_dir.clone(),
            legacy_dir,
            using_legacy: true,
        })
    }
}

fn ensure_dirs(dirs: &[&Path]) -> Result<(), AppError> {
    for dir in dirs {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn write_marker(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, b"")?;
    Ok(())
}

fn home_dir() -> Result<PathBuf, AppError> {
    if let Some(p) = std::env::var_os("HOME") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    if let Some(p) = std::env::var_os("USERPROFILE") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    if let (Some(drive), Some(path)) = (
        std::env::var_os("HOMEDRIVE"),
        std::env::var_os("HOMEPATH"),
    ) {
        if !drive.is_empty() && !path.is_empty() {
            let mut buf = PathBuf::from(drive);
            buf.push(path);
            return Ok(buf);
        }
    }

    Err(AppError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "Cannot determine home directory",
    )))
}

#[cfg(target_os = "linux")]
fn xdg_config_home(home: &Path) -> Result<PathBuf, AppError> {
    match std::env::var("XDG_CONFIG_HOME") {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => Ok(home.join(".config")),
    }
}

#[cfg(target_os = "linux")]
fn xdg_data_home(home: &Path) -> Result<PathBuf, AppError> {
    match std::env::var("XDG_DATA_HOME") {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => Ok(home.join(".local").join("share")),
    }
}

#[cfg(target_os = "linux")]
fn xdg_state_home(home: &Path) -> Result<PathBuf, AppError> {
    match std::env::var("XDG_STATE_HOME") {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => Ok(home.join(".local").join("state")),
    }
}

#[cfg(target_os = "linux")]
fn migrate_legacy_to_xdg(
    legacy_dir: &Path,
    config_dir: &Path,
    data_dir: &Path,
    state_dir: &Path,
) -> Result<(), AppError> {
    if !legacy_dir.exists() {
        return Ok(());
    }
    if !legacy_dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(legacy_dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let src_path = entry.path();

        let dest_root: &Path = match name_str.as_ref() {
            "settings.json" | "pipeline.json" | "skills_config.json" => config_dir,
            "skills" => data_dir,
            "logs" | "metrics.json" => state_dir,
            _ => data_dir,
        };

        let dest_path = dest_root.join(&name);

        if file_type.is_dir() {
            copy_dir_if_missing(&src_path, &dest_path)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&src_path, &dest_path)?;
        } else if file_type.is_symlink() {
            copy_symlink_if_missing(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_file_if_missing(src: &Path, dest: &Path) -> Result<(), AppError> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dest)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_dir_if_missing(src: &Path, dest: &Path) -> Result<(), AppError> {
    if dest.exists() {
        return Ok(());
    }
    fs::create_dir_all(dest)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_if_missing(&src_path, &dest_path)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&src_path, &dest_path)?;
        } else if file_type.is_symlink() {
            copy_symlink_if_missing(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_symlink_if_missing(src: &Path, dest: &Path) -> Result<(), AppError> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let target = fs::read_link(src)?;
    std::os::unix::fs::symlink(target, dest)?;
    Ok(())
}
