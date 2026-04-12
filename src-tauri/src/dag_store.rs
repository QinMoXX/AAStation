#![allow(dead_code, unused_imports)]

use crate::dag::types::DAGDocument;
use crate::error::AppError;
use std::fs;
use std::path::PathBuf;

/// Default directory name under the home directory.
const APP_DIR: &str = ".aastation";
/// Default file name for the pipeline document.
const PIPELINE_FILE: &str = "pipeline.json";
/// Temporary file suffix used for atomic writes.
const TMP_SUFFIX: &str = ".tmp";

/// Returns the path to the DAG pipeline file: `~/.aastation/pipeline.json`
fn pipeline_path() -> Result<PathBuf, AppError> {
    let home = dirs_home_dir()?;
    Ok(home.join(APP_DIR).join(PIPELINE_FILE))
}

/// Cross-platform home directory resolution.
fn dirs_home_dir() -> Result<PathBuf, AppError> {
    // Try standard HOME / USERPROFILE / HOMEPATH env vars
    if let Some(p) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(p));
    }
    // Windows: USERPROFILE
    if let Some(p) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(p));
    }
    // Windows fallback: HOMEDRIVE + HOMEPATH
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

/// Load the DAG document from disk.
/// Returns a default `DAGDocument` if the file does not exist.
pub fn load_dag() -> Result<DAGDocument, AppError> {
    let path = pipeline_path()?;

    if !path.exists() {
        return Ok(DAGDocument::default());
    }

    let content = fs::read_to_string(&path)?;

    // Try to parse as v2 document. If it fails (e.g. old v1 format with
    // removed node types), return a fresh default document so the user
    // can start over with the new node types.
    match serde_json::from_str::<DAGDocument>(&content) {
        Ok(doc) => Ok(doc),
        Err(_) => Ok(DAGDocument::default()),
    }
}

/// Save the DAG document to disk using atomic write (write to .tmp then rename).
pub fn save_dag(doc: &DAGDocument) -> Result<(), AppError> {
    let path = pipeline_path()?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp_path = path.with_extension(format!("json{}", TMP_SUFFIX));

    // Serialize to pretty JSON
    let content = serde_json::to_string_pretty(doc)?;

    // Write to temporary file
    fs::write(&tmp_path, &content)?;

    // Atomic rename (on Windows, this replaces the target if it exists)
    fs::rename(&tmp_path, &path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_home_dir_found() {
        // On any dev machine, home dir should be resolvable
        let home = dirs_home_dir();
        assert!(home.is_ok(), "Home directory should be found");
        assert!(home.unwrap().exists(), "Home directory should exist");
    }

    #[test]
    fn test_pipeline_path_format() {
        let path = pipeline_path().unwrap();
        assert!(path.to_string_lossy().contains(APP_DIR));
        assert!(path.to_string_lossy().ends_with(PIPELINE_FILE));
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        // Use a temp directory to avoid polluting real config
        let tmp_dir = std::env::temp_dir().join("aastation_test_roundtrip");
        let _ = fs::create_dir_all(&tmp_dir);
        let file_path = tmp_dir.join(PIPELINE_FILE);

        let mut doc = DAGDocument::default();
        doc.name = "Test Pipeline".to_string();

        // Manually write & read via the same logic as save_dag/load_dag
        let content = serde_json::to_string_pretty(&doc).unwrap();
        let tmp_path = file_path.with_extension("json.tmp");
        fs::write(&tmp_path, &content).unwrap();
        fs::rename(&tmp_path, &file_path).unwrap();

        let loaded: DAGDocument =
            serde_json::from_str(&fs::read_to_string(&file_path).unwrap()).unwrap();
        assert_eq!(loaded.name, "Test Pipeline");
        assert_eq!(loaded.version, 2);

        // Cleanup
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_load_nonexistent_returns_default() {
        // The real pipeline_path might not exist, but load_dag should return default
        let doc = load_dag();
        assert!(doc.is_ok());
    }
}
