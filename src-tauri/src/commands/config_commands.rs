use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::store::AppState;

#[derive(Debug, Deserialize)]
pub struct ExportConfigRequest {
    pub output_dir: String,
    pub include_sensitive_values: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ExportConfigResponse {
    pub archive_path: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportConfigRequest {
    pub archive_path: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportConfigResponse {
    pub manifest_warnings: Vec<String>,
}

#[tauri::command]
pub async fn export_config_archive(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExportConfigRequest,
) -> Result<ExportConfigResponse, String> {
    let metrics_snapshot = {
        let proxy = state.proxy.read().await;
        proxy.get_metrics_snapshot().await
    };

    let result = crate::config_export::export_config_archive(
        &app,
        crate::config_export::ConfigExportRequest {
            output_dir: PathBuf::from(request.output_dir),
            include_sensitive_values: request.include_sensitive_values,
            metrics_snapshot,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(ExportConfigResponse {
        archive_path: result.archive_path,
    })
}

#[tauri::command]
pub async fn import_config_archive(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ImportConfigRequest,
) -> Result<ImportConfigResponse, String> {
    let result = crate::config_import::import_config_archive(
        &app,
        state.inner(),
        crate::config_import::ConfigImportRequest {
            archive_path: PathBuf::from(request.archive_path),
        },
    )
    .await?;

    Ok(ImportConfigResponse {
        manifest_warnings: result.manifest_warnings,
    })
}
