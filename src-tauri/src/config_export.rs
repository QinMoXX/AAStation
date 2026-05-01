use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use crate::error::AppError;
use crate::skills::config::SKILLS_DIR_NAME;

pub const EXPORT_ARCHIVE_NAME: &str = "AAStationConfig.zip";

const APP_DIR: &str = ".aastation";
const HASH_FILE: &str = "hash.txt";
const HASH_KIND: &str = "hash";
const HASH_ALGORITHM: &str = "SHA-256";
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_KIND: &str = "manifest";
const SETTINGS_FILE: &str = "settings.json";
const PIPELINE_FILE: &str = "pipeline.json";
const SKILLS_CONFIG_FILE: &str = "skills_config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigExportManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub app: ManifestAppInfo,
    pub export_options: ManifestExportOptions,
    pub files: Vec<ManifestFileRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestAppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestExportOptions {
    pub include_sensitive_values: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFileRecord {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct ConfigExportRequest {
    pub output_dir: PathBuf,
    pub include_sensitive_values: bool,
    pub metrics_snapshot: crate::proxy::types::ProxyMetricsSnapshot,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigExportResult {
    pub archive_path: String,
}

#[derive(Debug, Clone)]
pub struct ExportContext {
    pub include_sensitive_values: bool,
    pub metrics_snapshot: crate::proxy::types::ProxyMetricsSnapshot,
}

pub struct ExportFileSpec {
    pub archive_name: &'static str,
    #[allow(dead_code)]
    pub kind: &'static str,
    pub loader: fn(&AppHandle, &ExportContext) -> Result<Vec<u8>, AppError>,
}

struct ExportArtifact {
    archive_name: String,
    bytes: Vec<u8>,
}

pub fn export_config_archive(
    app: &AppHandle,
    request: ConfigExportRequest,
) -> Result<ConfigExportResult, AppError> {
    fs::create_dir_all(&request.output_dir)?;

    let archive_path = request.output_dir.join(EXPORT_ARCHIVE_NAME);
    let context = ExportContext {
        include_sensitive_values: request.include_sensitive_values,
        metrics_snapshot: request.metrics_snapshot,
    };

    let file_specs = export_file_specs();
    let mut artifacts = build_export_artifacts(app, &context, &file_specs)?;

    // Collect skills directory files into artifacts (for hash computation).
    collect_skills_dir_artifacts(&mut artifacts)?;

    let manifest = build_manifest(app, &context, &artifacts);
    artifacts.push(ExportArtifact {
        archive_name: MANIFEST_FILE.to_string(),
        bytes: serde_json::to_vec_pretty(&manifest)?,
    });
    artifacts.push(ExportArtifact {
        archive_name: HASH_FILE.to_string(),
        bytes: build_hash_file_bytes(&artifacts),
    });

    let archive_file = File::create(&archive_path)?;
    let mut zip_writer = zip::ZipWriter::new(archive_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for artifact in &artifacts {
        zip_writer
            .start_file(&artifact.archive_name, options)
            .map_err(zip_to_io_error)?;
        zip_writer.write_all(&artifact.bytes)?;
    }
    zip_writer.finish().map_err(zip_to_io_error)?;

    Ok(ConfigExportResult {
        archive_path: archive_path.to_string_lossy().to_string(),
    })
}

fn build_manifest(
    app: &AppHandle,
    context: &ExportContext,
    artifacts: &[ExportArtifact],
) -> ConfigExportManifest {
    let package_info = app.package_info();

    ConfigExportManifest {
        schema_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        app: ManifestAppInfo {
            name: package_info.name.clone(),
            version: package_info.version.to_string(),
            identifier: app.config().identifier.clone(),
        },
        export_options: ManifestExportOptions {
            include_sensitive_values: context.include_sensitive_values,
        },
        files: artifacts
            .iter()
            .map(|a| {
                let kind = if a.archive_name.starts_with(&format!("{SKILLS_DIR_NAME}/")) {
                    "skill_file"
                } else if a.archive_name == SKILLS_CONFIG_FILE {
                    "skills_config"
                } else {
                    // Infer kind from archive_name for legacy file specs.
                    match a.archive_name.as_str() {
                        "metrics.json" => "proxy_metrics",
                        "pipeline.json" => "pipeline",
                        "settings.json" => "settings",
                        _ => "unknown",
                    }
                };
                ManifestFileRecord {
                    name: a.archive_name.clone(),
                    kind: kind.to_string(),
                }
            })
            .chain([
                ManifestFileRecord {
                    name: MANIFEST_FILE.to_string(),
                    kind: MANIFEST_KIND.to_string(),
                },
                ManifestFileRecord {
                    name: HASH_FILE.to_string(),
                    kind: HASH_KIND.to_string(),
                },
            ])
            .collect(),
    }
}

fn build_export_artifacts(
    app: &AppHandle,
    context: &ExportContext,
    file_specs: &[ExportFileSpec],
) -> Result<Vec<ExportArtifact>, AppError> {
    file_specs
        .iter()
        .map(|spec| {
            Ok(ExportArtifact {
                archive_name: spec.archive_name.to_string(),
                bytes: (spec.loader)(app, context)?,
            })
        })
        .collect()
}

fn export_file_specs() -> Vec<ExportFileSpec> {
    vec![
        ExportFileSpec {
            archive_name: "metrics.json",
            kind: "proxy_metrics",
            loader: load_metrics_bytes,
        },
        ExportFileSpec {
            archive_name: PIPELINE_FILE,
            kind: "pipeline",
            loader: load_pipeline_bytes,
        },
        ExportFileSpec {
            archive_name: SETTINGS_FILE,
            kind: "settings",
            loader: load_settings_bytes,
        },
        ExportFileSpec {
            archive_name: SKILLS_CONFIG_FILE,
            kind: "skills_config",
            loader: load_skills_config_bytes,
        },
    ]
}

fn load_metrics_bytes(_app: &AppHandle, context: &ExportContext) -> Result<Vec<u8>, AppError> {
    Ok(serde_json::to_vec_pretty(&context.metrics_snapshot)?)
}

fn load_pipeline_bytes(_app: &AppHandle, context: &ExportContext) -> Result<Vec<u8>, AppError> {
    let mut value = read_json_from_app_dir(PIPELINE_FILE)?.unwrap_or_else(default_pipeline_json);
    if !context.include_sensitive_values {
        redact_pipeline_api_keys(&mut value);
    }
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn load_settings_bytes(_app: &AppHandle, _context: &ExportContext) -> Result<Vec<u8>, AppError> {
    let value = read_json_from_app_dir(SETTINGS_FILE)?.unwrap_or_else(default_settings_json);
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn load_skills_config_bytes(_app: &AppHandle, _ctx: &ExportContext) -> Result<Vec<u8>, AppError> {
    let config = crate::skills::config::load_skills_config_json()?;
    Ok(serde_json::to_vec_pretty(&config)?)
}

/// Walk `~/.aastation/skills/` and collect each file into `artifacts`
/// for hash computation. Files will be written to the ZIP in the main loop.
fn collect_skills_dir_artifacts(
    artifacts: &mut Vec<ExportArtifact>,
) -> Result<(), AppError> {
    let skills_dir = app_dir_path()?.join(SKILLS_DIR_NAME);
    if !skills_dir.exists() {
        return Ok(());
    }

    fn walk(
        dir: &Path,
        base: &Path,
        artifacts: &mut Vec<ExportArtifact>,
    ) -> Result<(), AppError> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path
                .strip_prefix(base)
                .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("Path computation failed: {e}"))))?;

            // Use forward slashes for cross-platform compatibility
            let archive_name = format!(
                "{SKILLS_DIR_NAME}/{}",
                rel.to_string_lossy().replace('\\', "/")
            );

            if path.is_dir() {
                // Directory marker — empty bytes, but included so the hash covers the structure.
                artifacts.push(ExportArtifact {
                    archive_name,
                    bytes: Vec::new(),
                });
                walk(&path, base, artifacts)?;
            } else {
                let content = fs::read(&path)?;
                artifacts.push(ExportArtifact {
                    archive_name,
                    bytes: content,
                });
            }
        }
        Ok(())
    }

    walk(&skills_dir, &skills_dir, artifacts)
}

fn build_hash_file_bytes(artifacts: &[ExportArtifact]) -> Vec<u8> {
    let mut hasher = Sha256::new();

    for artifact in artifacts {
        hasher.update(artifact.archive_name.as_bytes());
        hasher.update(b"\n");
        hasher.update(artifact.bytes.len().to_string().as_bytes());
        hasher.update(b"\n");
        hasher.update(&artifact.bytes);
        hasher.update(b"\n");
    }

    let hash = format!("{:x}", hasher.finalize());
    let file_names = artifacts
        .iter()
        .map(|artifact| artifact.archive_name.as_str())
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "algorithm={HASH_ALGORITHM}\nfiles={file_names}\nhash={hash}\n"
    )
    .into_bytes()
}

fn redact_pipeline_api_keys(value: &mut Value) {
    let Some(nodes) = value.get_mut("nodes").and_then(Value::as_array_mut) else {
        return;
    };

    for node in nodes {
        let is_provider = node
            .get("node_type")
            .and_then(Value::as_str)
            .map(|node_type| node_type == "provider")
            .unwrap_or(false);
        if !is_provider {
            continue;
        }

        let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
            continue;
        };
        if data.contains_key("api_key") {
            data.insert("api_key".to_string(), Value::String(String::new()));
        }
        if data.contains_key("apiKey") {
            data.insert("apiKey".to_string(), Value::String(String::new()));
        }
    }
}

fn read_json_from_app_dir(file_name: &str) -> Result<Option<Value>, AppError> {
    let path = app_dir_path()?.join(file_name);
    read_optional_json(&path)
}

fn read_optional_json(path: &Path) -> Result<Option<Value>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)?;
    let value = serde_json::from_str(&content)?;
    Ok(Some(value))
}

fn app_dir_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(APP_DIR))
}

fn dirs_home_dir() -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(path));
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

fn default_pipeline_json() -> Value {
    serde_json::json!({
        "version": 2,
        "id": "",
        "name": "Untitled Pipeline",
        "nodes": [],
        "edges": [],
        "viewport": null,
        "updated_at": ""
    })
}

fn default_settings_json() -> Value {
    let settings = crate::settings::AppSettings::default();
    let mut object = Map::new();
    object.insert(
        "listen_port_range".to_string(),
        Value::String(settings.listen_port_range),
    );
    object.insert(
        "listen_address".to_string(),
        Value::String(settings.listen_address),
    );
    object.insert(
        "proxy_auth_token".to_string(),
        Value::String(settings.proxy_auth_token),
    );
    object.insert(
        "log_dir_max_mb".to_string(),
        Value::Number(settings.log_dir_max_mb.into()),
    );
    object.insert(
        "launch_at_startup".to_string(),
        Value::Bool(settings.launch_at_startup),
    );
    object.insert(
        "auto_check_update".to_string(),
        Value::Bool(settings.auto_check_update),
    );
    object.insert(
        "auto_install_update".to_string(),
        Value::Bool(settings.auto_install_update),
    );
    Value::Object(object)
}

fn zip_to_io_error(err: zip::result::ZipError) -> AppError {
    AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, err))
}
