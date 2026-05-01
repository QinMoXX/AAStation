use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::ZipArchive;

use crate::commands::{dag_commands, settings_commands};
use crate::config_export::ConfigExportManifest;
use crate::dag::types::DAGDocument;
use crate::proxy::types::{ProxyMetricsSnapshot, RouteTableSet};
use crate::settings::AppSettings;
use crate::store::AppState;

const HASH_FILE: &str = "hash.txt";
const MANIFEST_FILE: &str = "manifest.json";
const METRICS_FILE: &str = "metrics.json";
const PIPELINE_FILE: &str = "pipeline.json";
const SETTINGS_FILE: &str = "settings.json";
const SKILLS_CONFIG_FILE: &str = "skills_config.json";
const SKILLS_DIR_PREFIX: &str = "skills/";
const HASH_ALGORITHM: &str = "SHA-256";

#[derive(Debug, Clone)]
pub struct ConfigImportRequest {
    pub archive_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigImportResult {
    pub manifest_warnings: Vec<String>,
}

struct HashFileRecord {
    algorithm: String,
    files: Vec<String>,
    hash: String,
}

struct RollbackState {
    settings: AppSettings,
    dag: DAGDocument,
    metrics: ProxyMetricsSnapshot,
    route_table_set: RouteTableSet,
}

pub async fn import_config_archive(
    app: &AppHandle,
    state: &AppState,
    request: ConfigImportRequest,
) -> Result<ConfigImportResult, String> {
    let archive_entries = read_archive_entries(&request.archive_path)?;
    verify_archive_hash(&archive_entries)?;

    let manifest = parse_manifest(required_entry(&archive_entries, MANIFEST_FILE)?)?;
    let manifest_warnings = compare_manifest(app, &manifest);
    // TODO: Replace warning-only behavior with real compatibility gating based on
    // manifest schema_version, app identifier, and version policy.

    let imported_settings = parse_imported_settings(required_entry(&archive_entries, SETTINGS_FILE)?)?;
    let imported_dag = parse_imported_dag(required_entry(&archive_entries, PIPELINE_FILE)?)?;
    let imported_metrics = parse_imported_metrics(required_entry(&archive_entries, METRICS_FILE)?)?;
    let (imported_dag, imported_route_table_set) =
        dag_commands::prepare_route_table_set_with_settings(imported_dag, &imported_settings)?;

    let rollback = capture_rollback_state(state).await?;

    if let Err(import_err) = apply_import(
        app,
        state,
        imported_settings,
        imported_dag,
        imported_metrics,
        imported_route_table_set,
    )
    .await
    {
        let rollback_err = rollback_import(app, state, rollback).await.err();
        let failure_message = if let Some(rollback_err) = rollback_err {
            format!(
                "导入失败，已尝试回退，但回退过程中出现问题：{rollback_err}。原始错误：{import_err}"
            )
        } else {
            format!("导入失败，已回退原数据。请检查文件内容。原始错误：{import_err}")
        };
        return Err(failure_message);
    }

    // Import skills directory and config.
    let skills_result = import_skills_from_archive(&archive_entries)?;
    let mut manifest_warnings = manifest_warnings;
    if skills_result.imported_count > 0 {
        manifest_warnings.push(format!(
            "已导入 {} 个技能：{}",
            skills_result.imported_count,
            skills_result.skill_names.join("、")
        ));
    }

    Ok(ConfigImportResult { manifest_warnings })
}

async fn apply_import(
    app: &AppHandle,
    state: &AppState,
    settings: AppSettings,
    dag: DAGDocument,
    metrics: ProxyMetricsSnapshot,
    route_table_set: RouteTableSet,
) -> Result<(), String> {
    settings_commands::apply_settings(app, state, settings).await?;
    crate::dag_store::save_dag(&dag).map_err(|e| e.to_string())?;

    {
        let proxy = state.proxy.read().await;
        proxy.reload_routes(route_table_set).await;
    }

    let metrics_store = {
        let proxy = state.proxy.read().await;
        proxy.state.metrics.clone()
    };
    metrics_store.replace_with_snapshot(metrics).await?;

    Ok(())
}

async fn capture_rollback_state(state: &AppState) -> Result<RollbackState, String> {
    let settings = crate::settings::load_settings().map_err(|e| e.to_string())?;
    let dag = crate::dag_store::load_dag().map_err(|e| e.to_string())?;
    let (metrics, live_route_table_set) = {
        let proxy = state.proxy.read().await;
        (
            proxy.get_metrics_snapshot().await,
            proxy.route_table_set_snapshot().await,
        )
    };
    let route_table_set = if !live_route_table_set.tables.is_empty() {
        live_route_table_set
    } else {
        dag_commands::prepare_route_table_set_with_settings(dag.clone(), &settings)
            .map(|(_, route_table_set)| route_table_set)
            .unwrap_or_default()
    };

    Ok(RollbackState {
        settings,
        dag,
        metrics,
        route_table_set,
    })
}

async fn rollback_import(
    app: &AppHandle,
    state: &AppState,
    rollback: RollbackState,
) -> Result<(), String> {
    let mut errors = Vec::new();

    if let Err(err) = settings_commands::apply_settings(app, state, rollback.settings).await {
        errors.push(format!("恢复 settings.json 失败：{err}"));
    }

    if let Err(err) = crate::dag_store::save_dag(&rollback.dag).map_err(|e| e.to_string()) {
        errors.push(format!("恢复 pipeline.json 失败：{err}"));
    }

    {
        let proxy = state.proxy.read().await;
        proxy.reload_routes(rollback.route_table_set).await;
    }

    let metrics_store = {
        let proxy = state.proxy.read().await;
        proxy.state.metrics.clone()
    };
    if let Err(err) = metrics_store.replace_with_snapshot(rollback.metrics).await {
        errors.push(format!("恢复 metrics.json 失败：{err}"));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn read_archive_entries(archive_path: &Path) -> Result<HashMap<String, Vec<u8>>, String> {
    let file = File::open(archive_path).map_err(|e| format!("打开导入包失败：{e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取 ZIP 失败：{e}"))?;
    let mut entries = HashMap::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取 ZIP 条目失败：{e}"))?;
        if entry.is_dir() {
            continue;
        }

        let raw_name = entry.name().to_string();

        // Normalize entry name: preserve full relative path for skills/ entries,
        // use filename only for top-level files (backward compatibility).
        let normalized_name = if raw_name.starts_with(SKILLS_DIR_PREFIX) && raw_name.len() > SKILLS_DIR_PREFIX.len() {
            // Use forward-slash path as-is (already normalized in export).
            raw_name.clone()
        } else {
            // Top-level file — use filename only.
            Path::new(&raw_name)
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "导入包内存在无效文件名。".to_string())?
                .to_string()
        };

        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("读取 ZIP 文件内容失败：{e}"))?;

        if entries.insert(normalized_name.clone(), bytes).is_some() {
            return Err(format!("导入包内存在重复文件：{normalized_name}"));
        }
    }

    Ok(entries)
}

fn verify_archive_hash(entries: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    let hash_record = parse_hash_file(required_entry(entries, HASH_FILE)?)?;
    if hash_record.algorithm != HASH_ALGORITHM {
        return Err(format!(
            "导入包使用了不支持的哈希算法：{}",
            hash_record.algorithm
        ));
    }
    if hash_record.files.is_empty() {
        return Err("hash.txt 中未声明需要校验的文件。".to_string());
    }

    let files = hash_record
        .files
        .iter()
        .map(|name| {
            let bytes = required_entry(entries, name)?;
            Ok((name.as_str(), bytes))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let actual_hash = compute_hash_hex(&files);
    if actual_hash != hash_record.hash.to_lowercase() {
        return Err("导入包 Hash 校验失败，文件可能已损坏或被修改。".to_string());
    }

    Ok(())
}

/// Look up an entry by name. Supports both flat names (`settings.json`)
/// and nested paths (`skills/pdf-tools/SKILL.md`).
fn required_entry<'a>(
    entries: &'a HashMap<String, Vec<u8>>,
    file_name: &str,
) -> Result<&'a [u8], String> {
    entries
        .get(file_name)
        .map(Vec::as_slice)
        .ok_or_else(|| format!("导入包缺少必要文件：{file_name}"))
}

fn parse_hash_file(bytes: &[u8]) -> Result<HashFileRecord, String> {
    let content = std::str::from_utf8(bytes).map_err(|e| format!("hash.txt 不是有效文本：{e}"))?;
    let mut pairs = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (key, value) = trimmed
            .split_once('=')
            .ok_or_else(|| format!("hash.txt 格式错误：{trimmed}"))?;
        pairs.insert(key.trim().to_string(), value.trim().to_string());
    }

    let algorithm = pairs
        .remove("algorithm")
        .ok_or_else(|| "hash.txt 缺少 algorithm 字段。".to_string())?;
    let files = pairs
        .remove("files")
        .ok_or_else(|| "hash.txt 缺少 files 字段。".to_string())?
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let hash = pairs
        .remove("hash")
        .ok_or_else(|| "hash.txt 缺少 hash 字段。".to_string())?;

    Ok(HashFileRecord {
        algorithm,
        files,
        hash,
    })
}

fn parse_manifest(bytes: &[u8]) -> Result<ConfigExportManifest, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("manifest.json 无法解析：{e}"))
}

fn compare_manifest(app: &AppHandle, manifest: &ConfigExportManifest) -> Vec<String> {
    let package_info = app.package_info();
    let current_name = package_info.name.clone();
    let current_version = package_info.version.to_string();
    let current_identifier = app.config().identifier.clone();
    let mut warnings = Vec::new();

    if manifest.app.name != current_name {
        warnings.push(format!(
            "导入包应用名为 {}，当前应用名为 {}。",
            manifest.app.name, current_name
        ));
    }
    if manifest.app.version != current_version {
        warnings.push(format!(
            "导入包版本为 {}，当前版本为 {}。",
            manifest.app.version, current_version
        ));
    }
    if manifest.app.identifier != current_identifier {
        warnings.push(format!(
            "导入包标识为 {}，当前应用标识为 {}。",
            manifest.app.identifier, current_identifier
        ));
    }

    warnings
}

fn parse_imported_settings(bytes: &[u8]) -> Result<AppSettings, String> {
    let mut value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("settings.json 无法解析：{e}"))?;
    let defaults = AppSettings::default();

    let Some(object) = value.as_object_mut() else {
        return Err("settings.json 必须是一个 JSON 对象。".to_string());
    };

    if object.get("listen_port_range").is_none() {
        if let Some(port) = object.remove("listen_port").and_then(|value| value.as_u64()) {
            object.insert(
                "listen_port_range".to_string(),
                Value::String(format!("{port}-{}", port + 10)),
            );
        }
    }
    object
        .entry("listen_port_range".to_string())
        .or_insert_with(|| Value::String(defaults.listen_port_range.clone()));
    object
        .entry("listen_address".to_string())
        .or_insert_with(|| Value::String(defaults.listen_address.clone()));
    object
        .entry("proxy_auth_token".to_string())
        .or_insert_with(|| Value::String(defaults.proxy_auth_token.clone()));
    object
        .entry("log_dir_max_mb".to_string())
        .or_insert_with(|| Value::Number(defaults.log_dir_max_mb.into()));
    object
        .entry("launch_at_startup".to_string())
        .or_insert_with(|| Value::Bool(defaults.launch_at_startup));
    object
        .entry("auto_check_update".to_string())
        .or_insert_with(|| Value::Bool(defaults.auto_check_update));
    object
        .entry("auto_install_update".to_string())
        .or_insert_with(|| Value::Bool(defaults.auto_install_update));

    let mut settings: AppSettings =
        serde_json::from_value(value).map_err(|e| format!("settings.json 内容无效：{e}"))?;
    if settings.proxy_auth_token.trim().is_empty() {
        settings.proxy_auth_token = crate::settings::generate_auth_token();
    }
    crate::settings::parse_port_range(&settings.listen_port_range)
        .map_err(|e| format!("settings.json 端口范围无效：{e}"))?;

    Ok(settings)
}

fn parse_imported_dag(bytes: &[u8]) -> Result<DAGDocument, String> {
    let mut value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("pipeline.json 无法解析：{e}"))?;
    normalize_dag_value(&mut value);
    serde_json::from_value(value).map_err(|e| format!("pipeline.json 内容无效：{e}"))
}

fn normalize_dag_value(value: &mut Value) {
    let defaults = crate::dag::types::DAGDocument::default();
    let default_id = defaults.id;
    let default_name = defaults.name;

    let Some(object) = value.as_object_mut() else {
        return;
    };

    if object.get("updated_at").is_none() {
        if let Some(updated_at) = object.remove("updatedAt") {
            object.insert("updated_at".to_string(), updated_at);
        }
    }

    object
        .entry("version".to_string())
        .or_insert_with(|| Value::Number(2_u64.into()));
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(default_id));
    object
        .entry("name".to_string())
        .or_insert_with(|| Value::String(default_name));
    object
        .entry("nodes".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("edges".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("updated_at".to_string())
        .or_insert_with(|| Value::String(String::new()));

    if let Some(nodes) = object.get_mut("nodes").and_then(Value::as_array_mut) {
        for node in nodes {
            normalize_dag_node(node);
        }
    }

    if let Some(edges) = object.get_mut("edges").and_then(Value::as_array_mut) {
        for edge in edges {
            normalize_dag_edge(edge);
        }
    }
}

fn normalize_dag_node(node: &mut Value) {
    let Some(object) = node.as_object_mut() else {
        return;
    };

    if object.get("node_type").is_none() {
        if let Some(node_type) = object.remove("nodeType").or_else(|| object.remove("type")) {
            object.insert("node_type".to_string(), node_type);
        }
    }

    if let Some(node_type) = object.get("node_type").and_then(Value::as_str) {
        let normalized = match node_type {
            "terminal" => "application",
            "router" => "switcher",
            other => other,
        };
        object.insert("node_type".to_string(), Value::String(normalized.to_string()));
    }
}

fn normalize_dag_edge(edge: &mut Value) {
    let Some(object) = edge.as_object_mut() else {
        return;
    };

    if object.get("source_handle").is_none() {
        if let Some(source_handle) = object.remove("sourceHandle") {
            object.insert("source_handle".to_string(), source_handle);
        }
    }
    if object.get("target_handle").is_none() {
        if let Some(target_handle) = object.remove("targetHandle") {
            object.insert("target_handle".to_string(), target_handle);
        }
    }
}

fn parse_imported_metrics(bytes: &[u8]) -> Result<ProxyMetricsSnapshot, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("metrics.json 无法解析：{e}"))
}

fn compute_hash_hex(files: &[(&str, &[u8])]) -> String {
    let mut hasher = Sha256::new();

    for (name, bytes) in files {
        hasher.update(name.as_bytes());
        hasher.update(b"\n");
        hasher.update(bytes.len().to_string().as_bytes());
        hasher.update(b"\n");
        hasher.update(bytes);
        hasher.update(b"\n");
    }

    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// Skills import
// ---------------------------------------------------------------------------

/// Result of importing skills from the archive.
struct SkillsImportResult {
    imported_count: usize,
    skill_names: Vec<String>,
}

impl SkillsImportResult {
    fn skipped() -> Self {
        Self {
            imported_count: 0,
            skill_names: Vec::new(),
        }
    }
}

/// Import skills directory tree and `skills_config.json` from the archive.
fn import_skills_from_archive(
    entries: &HashMap<String, Vec<u8>>,
) -> Result<SkillsImportResult, String> {
    let skills_dir = crate::skills::skills_dir().map_err(|e| e.to_string())?;

    // Collect all entries that start with "skills/" (excluding the directory marker itself).
    let skill_file_entries: Vec<_> = entries
        .iter()
        .filter(|(name, _)| name.starts_with(SKILLS_DIR_PREFIX) && name.len() > SKILLS_DIR_PREFIX.len())
        .collect();

    if skill_file_entries.is_empty() {
        // Old version package with no skills directory — skip (backward compatible).
        return Ok(SkillsImportResult::skipped());
    }

    // Clear existing skills directory (full overwrite).
    if skills_dir.exists() {
        std::fs::remove_dir_all(&skills_dir)
            .map_err(|e| format!("清理旧 skills 目录失败：{e}"))?;
    }

    let mut imported_names = Vec::new();
    for (archive_name, content) in &skill_file_entries {
        // archive_name = "skills/pdf-tools/SKILL.md"
        let rel_path = match archive_name.strip_prefix(SKILLS_DIR_PREFIX) {
            Some(p) => p,
            None => continue,
        };
        if rel_path.is_empty() {
            continue;
        }

        let dest = skills_dir.join(rel_path);

        // Ensure parent directories exist.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录 {} 失败：{e}", parent.display()))?;
        }

        std::fs::write(&dest, content)
            .map_err(|e| format!("写入文件 {} 失败：{e}", archive_name))?;

        // Collect top-level skill directory name (deduplicated).
        let top_dir = rel_path.split('/').next().unwrap_or("");
        if !top_dir.is_empty() && !imported_names.contains(&top_dir.to_string()) {
            imported_names.push(top_dir.to_string());
        }
    }

    // Restore skills_config.json.
    if let Some(config_bytes) = entries.get(SKILLS_CONFIG_FILE) {
        let config_path = crate::skills::aastation_data_dir()
            .map_err(|e| e.to_string())?
            .join(SKILLS_CONFIG_FILE);
        std::fs::write(&config_path, config_bytes)
            .map_err(|e| format!("写入 skills_config.json 失败：{e}"))?;
    }

    // Rebuild tool symlinks from skills_config.json.
    rebuild_tool_symlinks()?;

    Ok(SkillsImportResult {
        imported_count: imported_names.len(),
        skill_names: imported_names,
    })
}

/// Rebuild symlinks/junctions for each tool based on `skills_config.json`.
fn rebuild_tool_symlinks() -> Result<(), String> {
    let config_path = crate::skills::aastation_data_dir()
        .map_err(|e| e.to_string())?
        .join(SKILLS_CONFIG_FILE);
    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取 skills_config.json 失败：{e}"))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 skills_config.json 失败：{e}"))?;

    let tools = match config.get("tools").and_then(|v| v.as_object()) {
        Some(t) => t,
        None => return Ok(()),
    };

    for (tool_name, tool_config) in tools {
        let enabled = match tool_config.get("enabled_skills").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => continue,
        };

        let tc = crate::skills::ToolConfig {
            name: tool_config
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            skills_path: tool_config
                .get("skills_path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            mode: tool_config
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("selective")
                .to_string(),
            enabled_skills: Vec::new(),
        };

        let adapter = crate::skills::SkillAdapter::from_config(tool_name, &tc);

        for skill_value in enabled {
            let skill_name = match skill_value.as_str() {
                Some(s) if !s.is_empty() => s,
                _ => continue,
            };
            if let Err(e) = adapter.enable_skill(skill_name) {
                tracing::warn!("Failed to enable skill '{}' for tool '{}': {e}", skill_name, tool_name);
            }
        }
    }

    Ok(())
}
