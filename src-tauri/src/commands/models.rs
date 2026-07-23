//! Model management commands.
//!
//! Commands:
//! - `model_list` — List installed model packages.
//! - `model_inspect_package` — Inspect a .lsmodel package file.
//! - `model_import_package` — Install a model from a .lsmodel package.
//! - `model_remove` — Remove an installed model.
//! - `model_refresh` — Refresh the model registry.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::recognition::state::RecognitionState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Summary of an installed model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Unique model identifier.
    pub id: String,

    /// Human-readable name.
    pub name: String,

    /// Task category: "formula-recognition", "text-detection", etc.
    pub task: String,

    /// Installed version.
    pub version: String,

    /// Model format: "onnx", "paddle", "torchscript", etc.
    pub format: String,

    /// Size in bytes on disk.
    pub size_bytes: u64,

    /// Whether the model is currently loaded.
    pub loaded: bool,
}

/// Result of inspecting a .lsmodel package.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInspectResult {
    /// Package manifest.
    pub manifest: ModelPackageManifest,

    /// Whether the package is compatible with the current system.
    pub compatible: bool,

    /// List of compatibility issues (if any).
    pub warnings: Vec<String>,
}

/// Manifest inside a .lsmodel package.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPackageManifest {
    pub name: String,
    pub version: String,
    pub task: String,
    pub format: String,
    pub author: Option<String>,
    pub description: Option<String>,
}

/// Result of a model operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOperationResult {
    pub success: bool,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List all installed models.
#[tauri::command]
pub async fn model_list(
    state: State<'_, RecognitionState>,
) -> Result<Vec<ModelInfo>, String> {
    let models_dir = &state.paths.models;
    if !models_dir.exists() {
        return Ok(Vec::new());
    }

    let mut models = Vec::new();

    // Walk the models directory for model subdirectories
    if let Ok(entries) = std::fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let model_id = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Try to read model manifest
            let manifest_path = path.join("manifest.json");
            let (name, task, version, format_str) = if manifest_path.exists() {
                match std::fs::read_to_string(&manifest_path) {
                    Ok(content) => {
                        match serde_json::from_str::<ModelPackageManifest>(&content) {
                            Ok(m) => (m.name, m.task, m.version, m.format),
                            Err(_) => (
                                model_id.clone(),
                                "unknown".to_string(),
                                "0.0.0".to_string(),
                                "unknown".to_string(),
                            ),
                        }
                    }
                    Err(_) => (
                        model_id.clone(),
                        "unknown".to_string(),
                        "0.0.0".to_string(),
                        "unknown".to_string(),
                    ),
                }
            } else {
                (model_id.clone(), "unknown".to_string(), "0.0.0".to_string(), "unknown".to_string())
            };

            // Calculate size
            let size_bytes = dir_size(&path).unwrap_or(0);

            models.push(ModelInfo {
                id: model_id,
                name,
                task,
                version,
                format: format_str,
                size_bytes,
                loaded: false, // Will be updated once engine integration is complete
            });
        }
    }

    Ok(models)
}

/// Inspect a .lsmodel package file without installing it.
#[tauri::command]
pub async fn model_inspect_package(
    path: String,
) -> Result<ModelInspectResult, String> {
    let p = std::path::Path::new(&path);

    if !p.is_file() {
        return Err(format!("Package file does not exist: {path}"));
    }

    // For now, treat .lsmodel as a zip archive with a manifest.json
    let file = std::fs::File::open(p)
        .map_err(|e| format!("Cannot open package: {e}"))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Cannot read package (invalid zip?): {e}"))?;

    let manifest: ModelPackageManifest = archive
        .by_name("manifest.json")
        .map_err(|_| "Package does not contain manifest.json".to_string())
        .and_then(|mut f| {
            let mut buf = String::new();
            std::io::Read::read_to_string(&mut f, &mut buf)
                .map_err(|e| format!("Cannot read manifest: {e}"))?;
            serde_json::from_str(&buf)
                .map_err(|e| format!("Cannot parse manifest: {e}"))
        })?;

    // Basic compatibility check
    let mut warnings = Vec::new();

    if manifest.format != "onnx" {
        warnings.push(format!(
            "Model format '{}' may require additional runtime support",
            manifest.format
        ));
    }

    Ok(ModelInspectResult {
        compatible: warnings.is_empty(),
        manifest,
        warnings,
    })
}

/// Import a .lsmodel package and rebuild the recognition service.
#[tauri::command]
pub async fn model_import_package(
    state: State<'_, RecognitionState>,
    path: String,
) -> Result<ModelOperationResult, String> {
    let p = std::path::Path::new(&path);

    if !p.is_file() {
        return Err(format!("Package file does not exist: {path}"));
    }

    // Inspect first
    let inspect = model_inspect_package(path.clone()).await?;

    let model_name = inspect.manifest.name.clone();
    let model_version = inspect.manifest.version.clone();

    // Install: extract to models/<name>/
    let dest_dir = state.paths.models.join(&model_name);

    if dest_dir.exists() {
        // Remove existing version
        std::fs::remove_dir_all(&dest_dir)
            .map_err(|e| format!("Cannot remove existing model: {e}"))?;
    }

    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Cannot create model directory: {e}"))?;

    // Extract the package
    let file = std::fs::File::open(p)
        .map_err(|e| format!("Cannot open package: {e}"))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Cannot read package: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("Cannot read entry {i}: {e}"))?;

        let out_path = match entry.enclosed_name() {
            Some(p) => dest_dir.join(p),
            None => continue,
        };

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Cannot create directory: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create parent directory: {e}"))?;
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Cannot create file: {e}"))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Cannot extract file: {e}"))?;
        }
    }

    log::info!("[Models] Installed {model_name} v{model_version}");

    // Rebuild the recognition service so new jobs use the new model
    #[cfg(feature = "recognition")]
    {
        if let Err(e) = state.rebuild_service().await {
            log::warn!("[Models] Service rebuild after install failed: {e}");
            return Ok(ModelOperationResult {
                success: true,
                message: format!(
                    "Model '{model_name}' installed but service rebuild failed: {e}. \
                     Restart the application to use it."
                ),
            });
        }
    }

    Ok(ModelOperationResult {
        success: true,
        message: format!("Model '{model_name}' v{model_version} installed successfully."),
    })
}

/// Remove an installed model.
#[tauri::command]
pub async fn model_remove(
    state: State<'_, RecognitionState>,
    model_id: String,
) -> Result<ModelOperationResult, String> {
    let model_dir = state.paths.models.join(&model_id);

    if !model_dir.exists() {
        return Err(format!("Model not found: {model_id}"));
    }

    std::fs::remove_dir_all(&model_dir)
        .map_err(|e| format!("Cannot remove model: {e}"))?;

    log::info!("[Models] Removed {model_id}");

    // Rebuild service
    #[cfg(feature = "recognition")]
    {
        if let Err(e) = state.rebuild_service().await {
            log::warn!("[Models] Service rebuild after remove failed: {e}");
        }
    }

    Ok(ModelOperationResult {
        success: true,
        message: format!("Model '{model_id}' removed."),
    })
}

/// Refresh the model registry and rebuild service if needed.
#[tauri::command]
pub async fn model_refresh(
    state: State<'_, RecognitionState>,
) -> Result<ModelOperationResult, String> {
    #[cfg(feature = "recognition")]
    {
        state.rebuild_service().await?;
    }

    Ok(ModelOperationResult {
        success: true,
        message: "Model registry refreshed.".to_string(),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Recursively calculate directory size.
fn dir_size(path: &std::path::Path) -> Result<u64, std::io::Error> {
    let mut total = 0u64;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_dir() {
                total += dir_size(&entry.path())?;
            } else {
                total += meta.len();
            }
        }
    }
    Ok(total)
}
