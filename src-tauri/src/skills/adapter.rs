use std::path::{Path, PathBuf};
use std::{fs, process};

use crate::error::AppError;
use crate::skills::config::{expand_tilde, skills_dir, ToolConfig};

/// Adapter for managing skill symlinks/junctions for a specific tool.
pub struct SkillAdapter {
    pub tool_name: String,
    pub skills_path: PathBuf,
}

impl SkillAdapter {
    /// Create an adapter from a `ToolConfig` entry.
    pub fn from_config(tool_name: &str, config: &ToolConfig) -> Self {
        Self {
            tool_name: tool_name.to_string(),
            skills_path: expand_tilde(&config.skills_path),
        }
    }

    /// Enable a skill: create a symlink/junction from the tool's skills dir
    /// to the central `~/.aastation/skills/<skill_name>` directory.
    pub fn enable_skill(&self, skill_name: &str) -> Result<(), AppError> {
        let source = skills_dir()?.join(skill_name);
        if !source.exists() {
            return Err(AppError::Skills(format!(
                "Skill '{}' not found in central skills directory",
                skill_name
            )));
        }

        let link_path = self.skills_path.join(skill_name);

        // Already linked to the correct target — no-op.
        if link_path.exists() {
            if let Ok(target) = fs::read_link(&link_path) {
                if target == source {
                    return Ok(());
                }
            }
            // Remove stale link or directory before re-creating.
            self.remove_entry(&link_path)?;
        }

        if let Some(parent) = link_path.parent() {
            fs::create_dir_all(parent)?;
        }

        create_link(&source, &link_path)?;
        tracing::info!(
            "Enabled skill '{}' for tool '{}' at {}",
            skill_name,
            self.tool_name,
            link_path.display()
        );
        Ok(())
    }

    /// Disable a skill: remove the symlink/junction from the tool's skills dir.
    pub fn disable_skill(&self, skill_name: &str) -> Result<(), AppError> {
        let link_path = self.skills_path.join(skill_name);
        if !link_path.exists() {
            return Ok(());
        }
        self.remove_entry(&link_path)?;
        tracing::info!(
            "Disabled skill '{}' for tool '{}' (removed {})",
            skill_name,
            self.tool_name,
            link_path.display()
        );
        Ok(())
    }

    /// List skill names currently linked in this tool's skills directory.
    pub fn list_enabled_skills(&self) -> Result<Vec<String>, AppError> {
        if !self.skills_path.exists() {
            return Ok(Vec::new());
        }
        let central = skills_dir()?;
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.skills_path)? {
            let entry = entry?;
            let path = entry.path();
            // Only count symlinks/junctions that point into our central skills dir.
            if is_link(&path) {
                if let Ok(target) = fs::read_link(&path) {
                    if target.starts_with(&central) {
                        if let Some(name) = path.file_name() {
                            names.push(name.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        names.sort();
        Ok(names)
    }

    fn remove_entry(&self, path: &Path) -> Result<(), AppError> {
        if is_link(path) {
            // Symlink or junction — remove the link itself.
            // On Windows, remove_dir works for junctions; remove_file for file symlinks.
            #[cfg(windows)]
            {
                // Try remove_dir first (junctions), then remove_file (file symlinks).
                fs::remove_dir(path).or_else(|_| fs::remove_file(path))?;
            }
            #[cfg(not(windows))]
            {
                fs::remove_file(path)?;
            }
        } else if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

// ---------- Link helpers ----------

/// Create a filesystem link from `source` to `link_path`.
///
/// On Windows, uses `mklink /J` (directory junction) which does not require
/// elevated privileges or developer mode. On Unix, uses `std::os::unix::fs::symlink`.
pub fn create_link(source: &Path, link_path: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        let source_str = source.to_string_lossy();
        let link_str = link_path.to_string_lossy();
        let output = process::Command::new("cmd")
            .args(["/c", "mklink", "/J", &link_str, &source_str])
            .output()
            .map_err(|e| AppError::Skills(format!("Failed to run mklink: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(AppError::Skills(format!(
                "mklink /J failed: {}{}",
                stderr.trim(),
                stdout.trim()
            )));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(source, link_path)?;
        Ok(())
    }
}

/// Check whether a path is a symlink (or junction on Windows).
pub fn is_link(path: &Path) -> bool {
    #[cfg(windows)]
    {
        // fs::symlink_metadata detects reparse points (junctions + symlinks)
        if let Ok(meta) = fs::symlink_metadata(path) {
            use std::os::windows::fs::MetadataExt;
            // FILE_ATTRIBUTE_REPARSE_POINT = 0x400
            return meta.file_attributes() & 0x400 != 0;
        }
        false
    }
    #[cfg(not(windows))]
    {
        fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }
}
