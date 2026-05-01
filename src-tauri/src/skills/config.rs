use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::{fs, path::Path};

use crate::error::AppError;

const SKILLS_CONFIG_FILE: &str = "skills_config.json";
pub const SKILLS_DIR_NAME: &str = "skills";

/// Top-level skills configuration persisted at `~/.aastation/skills_config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsConfig {
    /// Global sync mode: `"selective"` (default) or `"full"`.
    #[serde(default = "default_mode")]
    pub mode: String,
    /// Per-tool configuration, keyed by tool identifier (e.g. `"claude"`, `"opencode"`, `"codex"`).
    #[serde(default)]
    pub tools: std::collections::HashMap<String, ToolConfig>,
}

/// Per-tool skills configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolConfig {
    /// Display name (e.g. "Claude Code").
    #[serde(default)]
    pub name: String,
    /// Path to the tool's skills directory (may contain `~`).
    #[serde(default)]
    pub skills_path: String,
    /// Sync mode for this tool: `"selective"` or `"full"`.
    #[serde(default = "default_mode")]
    pub mode: String,
    /// List of enabled skill names (used when mode is `"selective"`).
    #[serde(default)]
    pub enabled_skills: Vec<String>,
}

fn default_mode() -> String {
    "selective".to_string()
}

fn default_tool_entries() -> std::collections::HashMap<String, ToolConfig> {
    let mut tools = std::collections::HashMap::new();
    tools.insert(
        "claude".to_string(),
        ToolConfig {
            name: "Claude Code".to_string(),
            skills_path: "~/.claude/skills/".to_string(),
            mode: "selective".to_string(),
            enabled_skills: Vec::new(),
        },
    );
    tools.insert(
        "opencode".to_string(),
        ToolConfig {
            name: "OpenCode".to_string(),
            skills_path: "~/.agents/skills/".to_string(),
            mode: "selective".to_string(),
            enabled_skills: Vec::new(),
        },
    );
    tools.insert(
        "codex".to_string(),
        ToolConfig {
            name: "Codex CLI".to_string(),
            skills_path: "~/.codex/skills/".to_string(),
            mode: "selective".to_string(),
            enabled_skills: Vec::new(),
        },
    );
    tools
}

impl Default for SkillsConfig {
    fn default() -> Self {
        Self {
            mode: "selective".to_string(),
            tools: default_tool_entries(),
        }
    }
}

/// Cross-platform home directory resolution.
fn home_dir() -> Result<PathBuf, AppError> {
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

/// Returns `~/.aastation/` directory path.
pub fn aastation_data_dir() -> Result<PathBuf, AppError> {
    Ok(home_dir()?.join(".aastation"))
}

/// Returns `~/.aastation/skills/` directory path.
pub fn skills_dir() -> Result<PathBuf, AppError> {
    Ok(aastation_data_dir()?.join(SKILLS_DIR_NAME))
}

/// Returns the full path to `skills_config.json`.
fn config_path() -> Result<PathBuf, AppError> {
    Ok(aastation_data_dir()?.join(SKILLS_CONFIG_FILE))
}

/// Expand a leading `~` to the user's home directory.
pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        home_dir().unwrap_or_else(|_| PathBuf::from(".")).join(rest)
    } else if path == "~" {
        home_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    }
}

/// Load `skills_config.json` from disk, initializing with defaults if absent.
pub fn load_or_init_config() -> Result<SkillsConfig, AppError> {
    let path = config_path()?;
    if path.exists() {
        let content = fs::read_to_string(&path)?;
        match serde_json::from_str::<SkillsConfig>(&content) {
            Ok(config) => return Ok(config),
            Err(e) => {
                tracing::warn!(
                    "Failed to parse {}: {e}, reinitializing with defaults",
                    path.display()
                );
            }
        }
    }
    let config = SkillsConfig::default();
    save_config(&config)?;
    Ok(config)
}

/// Persist `SkillsConfig` to disk atomically.
pub fn save_config(config: &SkillsConfig) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&tmp, &content)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// Resolve `skills_config.json` content from an `AppHandle` (used during export).
/// Returns a default JSON object when the file is absent.
pub fn load_skills_config_json() -> Result<serde_json::Value, AppError> {
    let path = config_path()?;
    if path.exists() {
        let content = fs::read_to_string(&path)?;
        return Ok(serde_json::from_str(&content)?);
    }
    Ok(serde_json::json!({
        "tools": {},
        "mode": "selective"
    }))
}

// ---------- Skills file I/O helpers ----------

/// Information about a single skill directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    #[serde(rename = "hasSkillMd")]
    pub has_skill_md: bool,
    /// List of tool identifiers that currently have this skill enabled.
    #[serde(rename = "enabledInTools", default)]
    pub enabled_in_tools: Vec<String>,
}

/// Scan `~/.aastation/skills/` and return metadata for every skill directory.
pub fn list_all_skills(config: &SkillsConfig) -> Result<Vec<SkillInfo>, AppError> {
    let dir = skills_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let skill_dir = entry.path();
        let skill_md_path = skill_dir.join("SKILL.md");
        let (has_skill_md, description) = if skill_md_path.exists() {
            let content = fs::read_to_string(&skill_md_path).unwrap_or_default();
            let desc = extract_description_from_skill_md(&content);
            (true, desc)
        } else {
            // No SKILL.md — try the first .md file in the directory
            let desc = extract_description_from_any_md(&skill_dir);
            (false, desc)
        };

        let enabled_in_tools = find_tools_with_skill(config, &name);

        skills.push(SkillInfo {
            name,
            description,
            has_skill_md,
            enabled_in_tools,
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

/// Extract the first meaningful paragraph from a SKILL.md file as a description.
///
/// Tries in order:
/// 1. First non-empty line after a `# heading` (skipping YAML frontmatter)
/// 2. First non-empty, non-heading line of the file
fn extract_description_from_skill_md(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_frontmatter = false;
    let mut frontmatter_done = false;

    // Pass 1: look for the first non-empty line after a top-level heading
    let mut found_heading = false;
    for &line in &lines {
        let trimmed = line.trim();

        // Skip YAML frontmatter (--- ... ---)
        if !frontmatter_done {
            if trimmed == "---" {
                in_frontmatter = !in_frontmatter;
                continue;
            }
            if in_frontmatter {
                continue;
            }
            frontmatter_done = true;
        }

        if !found_heading {
            if trimmed.starts_with("# ") {
                found_heading = true;
            }
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        return trimmed.to_string();
    }

    // Pass 2: no heading found — use the first non-empty, non-heading line
    in_frontmatter = false;
    frontmatter_done = false;
    for &line in &lines {
        let trimmed = line.trim();

        if !frontmatter_done {
            if trimmed == "---" {
                in_frontmatter = !in_frontmatter;
                continue;
            }
            if in_frontmatter {
                continue;
            }
            frontmatter_done = true;
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        return trimmed.to_string();
    }

    String::new()
}

/// Try to extract a description from the first `.md` file found in a skill directory.
fn extract_description_from_any_md(dir: &Path) -> String {
    let Ok(entries) = fs::read_dir(dir) else {
        return String::new();
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let desc = extract_description_from_skill_md(&content);
            if !desc.is_empty() {
                return desc;
            }
        }
    }
    String::new()
}

/// Find which tools currently have a given skill enabled (via symlinks).
fn find_tools_with_skill(config: &SkillsConfig, skill_name: &str) -> Vec<String> {
    let mut tools = Vec::new();
    for (tool_id, tool_config) in &config.tools {
        let tool_skills_dir = expand_tilde(&tool_config.skills_path);
        let link_path = tool_skills_dir.join(skill_name);
        if link_path.exists() {
            // Verify it actually points to our central skills dir
            if let Ok(target) = resolve_link_target(&link_path) {
                if let Ok(central_skills) = skills_dir() {
                    let expected = central_skills.join(skill_name);
                    if target == expected {
                        tools.push(tool_id.clone());
                    }
                }
            }
        }
    }
    tools
}

/// Resolve the target of a symlink or junction.
fn resolve_link_target(path: &Path) -> Result<PathBuf, std::io::Error> {
    #[cfg(windows)]
    {
        // On Windows, fs::read_link works for both symlinks and junctions
        fs::read_link(path)
    }
    #[cfg(not(windows))]
    {
        fs::read_link(path)
    }
}
