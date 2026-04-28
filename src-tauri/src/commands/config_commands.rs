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
