use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use crate::error::AppError;

pub const EXPORT_ARCHIVE_NAME: &str = "AAStationConfig.zip";

const APP_DIR: &str = ".aastation";
const SETTINGS_FILE: &str = "settings.json";
const PIPELINE_FILE: &str = "pipeline.json";

#[derive(Debug, Clone, Serialize)]
pub struct ConfigExportManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub app: ManifestAppInfo,
    pub export_options: ManifestExportOptions,
    pub files: Vec<ManifestFileRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManifestAppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManifestExportOptions {
    pub include_sensitive_values: bool,
}

#[derive(Debug, Clone, Serialize)]
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
    pub kind: &'static str,
    pub loader: fn(&AppHandle, &ExportContext) -> Result<Vec<u8>, AppError>,
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
    let manifest = build_manifest(app, &context, &file_specs);

    let archive_file = File::create(&archive_path)?;
    let mut zip_writer = zip::ZipWriter::new(archive_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for spec in &file_specs {
        let bytes = (spec.loader)(app, &context)?;
        zip_writer
            .start_file(spec.archive_name, options)
            .map_err(zip_to_io_error)?;
        zip_writer.write_all(&bytes)?;
    }

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    zip_writer
        .start_file("manifest.json", options)
        .map_err(zip_to_io_error)?;
    zip_writer.write_all(&manifest_bytes)?;
    zip_writer.finish().map_err(zip_to_io_error)?;

    Ok(ConfigExportResult {
        archive_path: archive_path.to_string_lossy().to_string(),
    })
}

fn build_manifest(
    app: &AppHandle,
    context: &ExportContext,
    file_specs: &[ExportFileSpec],
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
        files: file_specs
            .iter()
            .map(|spec| ManifestFileRecord {
                name: spec.archive_name.to_string(),
                kind: spec.kind.to_string(),
            })
            .chain(std::iter::once(ManifestFileRecord {
                name: "manifest.json".to_string(),
                kind: "manifest".to_string(),
            }))
            .collect(),
    }
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
