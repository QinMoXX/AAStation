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

// ---------- Project-level skills management ----------

/// Tool definitions for project-level skill scanning.
/// Each entry maps a tool identifier to its skills directory relative to the project root.
const PROJECT_TOOL_SKILLS_PATHS: &[(&str, &str)] = &[
    ("claude", ".claude/skills"),
    ("codex", ".codex/skills"),
    ("opencode", ".opencode/skills"),
    ("cursor", ".cursor/skills"),
    ("windsurf", ".windsurf/skills"),
    ("cline", ".cline/skills"),
];

/// Result of scanning a single tool's skills directory in a project.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectToolScanResult {
    pub tool_id: String,
    pub tool_name: String,
    pub skills_found: usize,
    pub skill_names: Vec<String>,
    /// `"collected"` | `"already_linked"` | `"not_found"` | `"error"`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Overall result of project-level skills collection.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectSkillsResult {
    pub project_path: String,
    pub central_path: String,
    pub tools: Vec<ProjectToolScanResult>,
    pub total_skills: usize,
}

/// Scan a project directory for tool-specific skills directories and collect
/// them into `<project>/.agents/skills/`. Each tool's original skills directory
/// is replaced with a link (junction on Windows, relative symlink on Unix)
/// pointing back to `.agents/skills/`.
pub fn collect_project_skills(project_path: &Path) -> Result<ProjectSkillsResult, AppError> {
    let central = project_path.join(".agents").join("skills");
    fs::create_dir_all(&central)?;

    let mut tools_results = Vec::new();

    for (tool_id, tool_rel_path) in PROJECT_TOOL_SKILLS_PATHS {
        let tool_skills_dir = project_path.join(tool_rel_path);

        let mut result = ProjectToolScanResult {
            tool_id: tool_id.to_string(),
            tool_name: tool_id.to_string(),
            skills_found: 0,
            skill_names: Vec::new(),
            status: "not_found".to_string(),
            error: None,
        };

        if !tool_skills_dir.exists() {
            tools_results.push(result);
            continue;
        }

        // Already a link pointing to .agents/skills — skip processing
        // but still read skill names from central for accurate reporting
        if is_link(&tool_skills_dir) {
            if let Ok(target) = fs::read_link(&tool_skills_dir) {
                if target == central || target.ends_with(".agents/skills") {
                    result.status = "already_linked".to_string();
                    // Populate skills from the central directory
                    if let Ok(entries) = fs::read_dir(&central) {
                        for entry in entries.flatten() {
                            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                result.skill_names.push(
                                    entry.file_name().to_string_lossy().to_string(),
                                );
                            }
                        }
                        result.skill_names.sort();
                        result.skills_found = result.skill_names.len();
                    }
                    tools_results.push(result);
                    continue;
                }
            }
        }

        // Process directory: move skill subdirs into central, then replace with link
        match process_project_tool_dir(&tool_skills_dir, &central, &mut result) {
            Ok(()) => {
                fs::remove_dir_all(&tool_skills_dir)?;
                crate::skills::adapter::create_relative_link(&central, &tool_skills_dir)?;
            }
            Err(e) => {
                result.status = "error".to_string();
                result.error = Some(e.to_string());
            }
        }

        tools_results.push(result);
    }

    let total_skills = count_skills_in_dir(&central);
    Ok(ProjectSkillsResult {
        project_path: project_path.display().to_string(),
        central_path: central.display().to_string(),
        tools: tools_results,
        total_skills,
    })
}

/// Move skill subdirectories from a tool's skills directory into the central directory.
fn process_project_tool_dir(
    tool_dir: &Path,
    central: &Path,
    result: &mut ProjectToolScanResult,
) -> Result<(), AppError> {
    let mut skill_names = Vec::new();

    for entry in fs::read_dir(tool_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let src = entry.path();

        // If the entry is already a symlink/junction, just record it — no need to move
        if is_link(&src) {
            skill_names.push(name);
            continue;
        }

        let dest = central.join(&name);

        if dest.exists() {
            tracing::warn!(
                "[project_skills] Skill '{}' already exists in .agents/skills, skipping",
                name
            );
            skill_names.push(name);
            continue;
        }

        move_dir(&src, &dest)?;
        skill_names.push(name);
    }

    skill_names.sort();
    result.skills_found = skill_names.len();
    result.skill_names = skill_names;
    result.status = "collected".to_string();
    Ok(())
}

/// Count the number of subdirectories (skills) in a directory.
fn count_skills_in_dir(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0)
}
