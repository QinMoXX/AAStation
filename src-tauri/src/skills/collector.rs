use std::path::Path;
use std::{fs, process};

use serde::Serialize;

use crate::error::AppError;
use crate::skills::config::{expand_tilde, load_or_init_config, save_config, SkillsConfig, ToolConfig};

/// Result of scanning a single tool's skills directory.
#[derive(Debug, Clone, Serialize)]
pub struct ToolScanResult {
    pub tool_id: String,
    pub tool_name: String,
    /// Number of skill directories found in the tool's skills directory.
    pub skills_found: usize,
    /// Names of discovered skills.
    pub skill_names: Vec<String>,
    /// `"found"` if the tool's skills directory exists, `"not_found"` otherwise.
    pub status: String,
}

/// Scan all configured tools' skills directories and collect them into
/// `~/.aastation/skills/`.
///
/// Returns scan results for each tool. Skills that already exist in the
/// central directory are not overwritten; only new skills are copied.
pub fn collect_skills() -> Result<(SkillsConfig, Vec<ToolScanResult>), AppError> {
    let config = load_or_init_config()?;
    let central_skills = crate::skills::config::skills_dir()?;
    fs::create_dir_all(&central_skills)?;

    let mut results = Vec::new();

    // Clone tool keys to avoid borrowing `config` while iterating.
    let tool_ids: Vec<String> = config.tools.keys().cloned().collect();

    for tool_id in &tool_ids {
        let tool_config = &config.tools[tool_id];
        let tool_skills_dir = expand_tilde(&tool_config.skills_path);

        if !tool_skills_dir.exists() {
            results.push(ToolScanResult {
                tool_id: tool_id.clone(),
                tool_name: tool_config.name.clone(),
                skills_found: 0,
                skill_names: Vec::new(),
                status: "not_found".to_string(),
            });
            continue;
        }

        let mut skill_names = Vec::new();
        for entry in fs::read_dir(&tool_skills_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let dest = central_skills.join(&name);
            if !dest.exists() {
                copy_dir_recursive(&entry.path(), &dest)?;
            }
            skill_names.push(name);
        }

        skill_names.sort();
        let count = skill_names.len();
        results.push(ToolScanResult {
            tool_id: tool_id.clone(),
            tool_name: tool_config.name.clone(),
            skills_found: count,
            skill_names,
            status: "found".to_string(),
        });
    }

    Ok((config, results))
}

/// Add a custom tool entry to `skills_config.json`.
pub fn add_tool(
    tool_id: String,
    name: String,
    skills_path: String,
) -> Result<SkillsConfig, AppError> {
    let mut config = load_or_init_config()?;
    config.tools.insert(
        tool_id,
        ToolConfig {
            name,
            skills_path,
            mode: "selective".to_string(),
            enabled_skills: Vec::new(),
        },
    );
    save_config(&config)?;
    Ok(config)
}

/// Remove a tool entry from `skills_config.json` (does not delete its symlinks).
pub fn remove_tool(tool_id: &str) -> Result<SkillsConfig, AppError> {
    let mut config = load_or_init_config()?;
    config.tools.remove(tool_id);
    save_config(&config)?;
    Ok(config)
}

// ---------- Directory copy helper ----------

/// Recursively copy a directory tree.
///
/// - **Windows**: `xcopy /E /I /Q /Y`
/// - **macOS**: `cp -a`
/// - **Linux**: `cp -a`
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::create_dir_all(to)?;

    #[cfg(target_os = "windows")]
    {
        let from_arg = format!("\"{}\"", from.to_string_lossy().replace('/', "\\"));
        let to_arg = format!("\"{}\\\"", to.to_string_lossy().replace('/', "\\"));
        tracing::info!("[skills] Copying directory: xcopy {} {} /E /I /Q /Y", from_arg, to_arg);
        let output = process::Command::new("xcopy")
            .args([&from_arg, &to_arg, "/E", "/I", "/Q", "/Y"])
            .output()
            .map_err(|e| AppError::Skills(format!("Failed to run xcopy: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let msg = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };
            return Err(AppError::Skills(format!("xcopy failed: {}", msg)));
        }
    }
    #[cfg(target_os = "macos")]
    {
        tracing::info!(
            "[skills] Copying directory: cp -a \"{}\" \"{}\"",
            from.display(),
            to.display()
        );
        let output = process::Command::new("cp")
            .args(["-a", &from.to_string_lossy(), &to.to_string_lossy()])
            .output()
            .map_err(|e| AppError::Skills(format!("Failed to run cp: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Skills(format!("cp failed: {}", stderr.trim())));
        }
    }
    #[cfg(target_os = "linux")]
    {
        tracing::info!(
            "[skills] Copying directory: cp -a \"{}\" \"{}\"",
            from.display(),
            to.display()
        );
        let output = process::Command::new("cp")
            .args(["-a", &from.to_string_lossy(), &to.to_string_lossy()])
            .output()
            .map_err(|e| AppError::Skills(format!("Failed to run cp: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Skills(format!("cp failed: {}", stderr.trim())));
        }
    }

    Ok(())
}
