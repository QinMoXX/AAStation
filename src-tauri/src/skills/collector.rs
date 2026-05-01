use std::path::Path;
use std::fs;

use serde::Serialize;

use crate::error::AppError;
use crate::skills::adapter::{is_link, SkillAdapter};
use crate::skills::config::{expand_tilde, load_or_init_config, save_config, skills_dir, SkillsConfig, ToolConfig};

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
/// Each discovered skill is **moved** (not copied) to the central directory,
/// then a symlink/junction is created from the original location back to
/// central so the tool continues to work. The skill is also marked as
/// enabled for the source tool in the config.
pub fn collect_skills() -> Result<(SkillsConfig, Vec<ToolScanResult>), AppError> {
    let mut config = load_or_init_config()?;
    let central = skills_dir()?;
    fs::create_dir_all(&central)?;

    let mut results = Vec::new();
    let tool_ids: Vec<String> = config.tools.keys().cloned().collect();

    for tool_id in &tool_ids {
        let (tool_name, tool_skills_dir) = {
            let tc = &config.tools[tool_id];
            (tc.name.clone(), expand_tilde(&tc.skills_path))
        };

        if !tool_skills_dir.exists() {
            results.push(ToolScanResult {
                tool_id: tool_id.clone(),
                tool_name,
                skills_found: 0,
                skill_names: Vec::new(),
                status: "not_found".to_string(),
            });
            continue;
        }

        let adapter = SkillAdapter::from_config(tool_id, &config.tools[tool_id]);
        let mut skill_names = Vec::new();

        for entry in fs::read_dir(&tool_skills_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let src = entry.path();

            // Already a link to central — already collected previously
            if is_link(&src) {
                skill_names.push(name);
                continue;
            }

            let dest = central.join(&name);

            if dest.exists() {
                // Central already has a skill with this name — skip, leave as-is
                tracing::warn!(
                    "[skills] Skill '{}' already exists in central directory, skipping move",
                    name
                );
                skill_names.push(name);
                continue;
            }

            // Move skill directory to central
            move_dir(&src, &dest)?;

            // Create link from tool's dir back to central
            adapter.enable_skill(&name)?;

            // Mark skill as enabled in config
            let cfg_entry = config.tools.get_mut(tool_id).unwrap();
            if !cfg_entry.enabled_skills.contains(&name) {
                cfg_entry.enabled_skills.push(name.clone());
            }

            skill_names.push(name);
        }

        skill_names.sort();
        let count = skill_names.len();
        results.push(ToolScanResult {
            tool_id: tool_id.clone(),
            tool_name,
            skills_found: count,
            skill_names,
            status: "found".to_string(),
        });
    }

    // Persist updated config (new enabled_skills entries)
    save_config(&config)?;
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

// ---------- Directory move/copy helpers ----------

/// Move a directory. Tries `fs::rename` first (fast, same filesystem);
/// falls back to copy-then-delete for cross-device moves.
fn move_dir(from: &Path, to: &Path) -> Result<(), AppError> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // Cross-device: copy then remove source
    copy_dir_recursive(from, to)?;
    fs::remove_dir_all(from)?;
    Ok(())
}

/// Recursively copy a directory tree using native Rust I/O.
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}
