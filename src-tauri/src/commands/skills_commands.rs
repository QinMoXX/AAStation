use serde::Serialize;
use tauri::AppHandle;

use crate::skills::{self, adapter::SkillAdapter, ProjectSkillsResult, SkillInfo, ToolScanResult};

/// Result of the `collect_skills` command.
#[derive(Debug, Clone, Serialize)]
pub struct CollectSkillsResult {
    pub tools: Vec<ToolScanResult>,
    pub skills: Vec<SkillInfo>,
}

/// Scan all configured tools' skills directories and collect them into the
/// central `~/.aastation/skills/` directory.
#[tauri::command]
pub async fn collect_skills() -> Result<CollectSkillsResult, String> {
    let (config, tool_results) = skills::collect_skills().map_err(|e| e.to_string())?;
    let skill_list = skills::config::list_all_skills(&config).map_err(|e| e.to_string())?;
    Ok(CollectSkillsResult {
        tools: tool_results,
        skills: skill_list,
    })
}

/// Return the `tools` field from `skills_config.json` for frontend dynamic rendering.
#[tauri::command]
pub async fn get_skills_tool_config(_app: AppHandle) -> Result<serde_json::Value, String> {
    let config_path = skills::aastation_data_dir()
        .map_err(|e| e.to_string())?
        .join("skills_config.json");

    if !config_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content =
        std::fs::read_to_string(&config_path).map_err(|e| format!("读取 skills_config.json 失败：{e}"))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 skills_config.json 失败：{e}"))?;
    Ok(config.get("tools").cloned().unwrap_or(serde_json::json!({})))
}

/// List all skills in the central skills directory, with per-tool enabled status.
#[tauri::command]
pub async fn list_skills() -> Result<Vec<SkillInfo>, String> {
    let config = skills::load_or_init_config().map_err(|e| e.to_string())?;
    skills::config::list_all_skills(&config).map_err(|e| e.to_string())
}

/// Enable a skill for a specific tool (create symlink/junction).
#[tauri::command]
pub async fn enable_skill(skill_name: String, tool: String) -> Result<(), String> {
    let config = skills::load_or_init_config().map_err(|e| e.to_string())?;
    let tool_config = config
        .tools
        .get(&tool)
        .ok_or_else(|| format!("未找到工具配置：{tool}"))?;

    let adapter = SkillAdapter::from_config(&tool, tool_config);
    adapter
        .enable_skill(&skill_name)
        .map_err(|e| e.to_string())?;

    // Update config: add skill to enabled_skills if not present.
    let mut config = config;
    let entry = config.tools.get_mut(&tool).unwrap();
    if !entry.enabled_skills.contains(&skill_name) {
        entry.enabled_skills.push(skill_name);
    }
    skills::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Disable a skill for a specific tool (remove symlink/junction).
#[tauri::command]
pub async fn disable_skill(skill_name: String, tool: String) -> Result<(), String> {
    let config = skills::load_or_init_config().map_err(|e| e.to_string())?;
    let tool_config = config
        .tools
        .get(&tool)
        .ok_or_else(|| format!("未找到工具配置：{tool}"))?;

    let adapter = SkillAdapter::from_config(&tool, tool_config);
    adapter
        .disable_skill(&skill_name)
        .map_err(|e| e.to_string())?;

    // Update config: remove skill from enabled_skills.
    let mut config = config;
    if let Some(entry) = config.tools.get_mut(&tool) {
        entry.enabled_skills.retain(|s| s != &skill_name);
    }
    skills::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Enable all skills in the central directory for a specific tool.
#[tauri::command]
pub async fn enable_all_skills(tool: String) -> Result<(), String> {
    let config = skills::load_or_init_config().map_err(|e| e.to_string())?;
    let skill_infos = skills::config::list_all_skills(&config).map_err(|e| e.to_string())?;

    let tool_config = config
        .tools
        .get(&tool)
        .ok_or_else(|| format!("未找到工具配置：{tool}"))?;

    let adapter = SkillAdapter::from_config(&tool, tool_config);
    let mut config = config;
    let entry = config.tools.get_mut(&tool).unwrap();
    entry.enabled_skills.clear();

    for skill in &skill_infos {
        adapter
            .enable_skill(&skill.name)
            .map_err(|e| e.to_string())?;
        entry.enabled_skills.push(skill.name.clone());
    }

    skills::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Disable all skills for a specific tool.
#[tauri::command]
pub async fn disable_all_skills(tool: String) -> Result<(), String> {
    let config = skills::load_or_init_config().map_err(|e| e.to_string())?;
    let tool_config = config
        .tools
        .get(&tool)
        .ok_or_else(|| format!("未找到工具配置：{tool}"))?;

    let adapter = SkillAdapter::from_config(&tool, tool_config);
    let enabled = adapter.list_enabled_skills().map_err(|e| e.to_string())?;

    for skill_name in &enabled {
        adapter
            .disable_skill(skill_name)
            .map_err(|e| e.to_string())?;
    }

    let mut config = config;
    if let Some(entry) = config.tools.get_mut(&tool) {
        entry.enabled_skills.clear();
    }
    skills::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Add a custom tool entry to the skills config.
#[tauri::command]
pub async fn add_skills_tool(
    tool_id: String,
    name: String,
    skills_path: String,
) -> Result<serde_json::Value, String> {
    let config = skills::collector::add_tool(tool_id, name, skills_path)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&config).map_err(|e| e.to_string())
}

/// Remove a tool entry from the skills config.
#[tauri::command]
pub async fn remove_skills_tool(tool_id: String) -> Result<serde_json::Value, String> {
    let config = skills::collector::remove_tool(&tool_id).map_err(|e| e.to_string())?;
    serde_json::to_value(&config).map_err(|e| e.to_string())
}

/// Collect project-level skills: scan a project directory for tool-specific
/// skills directories, move them into `<project>/.agents/skills/`, and replace
/// the original directories with links (junctions on Windows, relative symlinks
/// on Unix).
#[tauri::command]
pub async fn collect_project_skills(
    project_path: String,
) -> Result<ProjectSkillsResult, String> {
    let path = std::path::Path::new(&project_path);
    if !path.is_dir() {
        return Err("所选路径不是有效目录".to_string());
    }
    skills::collect_project_skills(path).map_err(|e| e.to_string())
}
