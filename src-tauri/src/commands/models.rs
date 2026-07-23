//! Model management commands.
//!
//! These commands delegate model lifecycle to Core's ModelManager and
//! ModelRegistry. Office does NOT maintain its own model manifest format.
//! Core's canonical model directory structure is:
//!
//! ```text
//! models/<category>/<variant>/manifest.toml
//! ```
//!
//! The `.lsmodel` transport format is a zip containing a single model
//! directory with Core's `manifest.toml` at its root.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::recognition::state::RecognitionState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Summary of an installed model, derived from Core's ModelRegistry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub task: String,
    pub version: String,
    pub format: String,
    pub size_bytes: u64,
    pub loaded: bool,
}

/// Result of inspecting a .lsmodel package.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInspectResult {
    /// Parsed manifest as JSON (may be v2 or v3 Core format).
    pub manifest: serde_json::Value,
    pub compatible: bool,
    pub warnings: Vec<String>,
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

/// List installed models by scanning the models directory.
#[tauri::command]
pub async fn model_list(state: State<'_, RecognitionState>) -> Result<Vec<ModelInfo>, String> {
    let models_dir = &state.paths.models;
    if !models_dir.exists() {
        return Ok(Vec::new());
    }

    let mut models = Vec::new();

    // Walk Core's category/variant structure
    for category_entry in std::fs::read_dir(models_dir).map_err(|e| e.to_string())? {
        let category_entry = category_entry.map_err(|e| e.to_string())?;
        let category_path = category_entry.path();
        if !category_path.is_dir() {
            continue;
        }

        let category = category_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        for variant_entry in std::fs::read_dir(&category_path).map_err(|e| e.to_string())? {
            let variant_entry = variant_entry.map_err(|e| e.to_string())?;
            let variant_path = variant_entry.path();
            if !variant_path.is_dir() {
                continue;
            }

            let variant = variant_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Look for Core's manifest.toml (NOT a custom manifest.json)
            let manifest_path = variant_path.join("manifest.toml");
            let (name, version, format_str) = if manifest_path.exists() {
                match std::fs::read_to_string(&manifest_path) {
                    Ok(content) => {
                        match latexsnipper_model::LoadedModelManifest::parse(&content) {
                            Ok(loaded) => {
                                let (n, v, f) = extract_manifest_info(&loaded);
                                (n, v, f)
                            }
                            Err(_) => (variant.clone(), "0.0.0".to_string(), "unknown".to_string()),
                        }
                    }
                    Err(_) => (variant.clone(), "0.0.0".to_string(), "unknown".to_string()),
                }
            } else {
                // Legacy: some models may still have artifacts without manifest
                (variant.clone(), "0.0.0".to_string(), detect_format(&variant_path))
            };

            let size_bytes = dir_size(&variant_path).unwrap_or(0);
            let model_id = format!("{category}/{variant}");
            let task_category = category.clone();

            models.push(ModelInfo {
                id: model_id,
                name,
                task: task_category,
                version,
                format: format_str,
                size_bytes,
                loaded: false,
            });
        }
    }

    Ok(models)
}

/// Inspect a .lsmodel package using Core's manifest parser.
#[tauri::command]
pub async fn model_inspect_package(path: String) -> Result<ModelInspectResult, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("Package file does not exist: {path}"));
    }

    let file = std::fs::File::open(p).map_err(|e| format!("Cannot open package: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Cannot read package: {e}"))?;

    // Look for manifest.toml (Core format) first, fall back to manifest.json
    let manifest_content = read_archive_file(&mut archive, "manifest.toml")
        .or_else(|_| read_archive_file(&mut archive, "manifest.json"))?;

    let mut warnings = Vec::new();
    let compatible: bool;

    // Parse with Core's version-aware manifest loader
    let manifest_value: serde_json::Value = match latexsnipper_model::LoadedModelManifest::parse(&manifest_content) {
        Ok(loaded) => {
            compatible = true;
            match loaded {
                latexsnipper_model::LoadedModelManifest::V2(m) => {
                    serde_json::to_value(&m).unwrap_or_default()
                }
                latexsnipper_model::LoadedModelManifest::V3(m) => {
                    serde_json::to_value(&m).unwrap_or_default()
                }
            }
        }
        Err(e) => {
            compatible = false;
            warnings.push(format!("Manifest parse failed: {e}"));
            // Try to return the raw content so the user can debug
            serde_json::json!({"error": format!("{e}"), "raw": manifest_content})
        }
    };

    Ok(ModelInspectResult {
        manifest: manifest_value,
        compatible,
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

    // Step 1: Inspect the package
    let inspect = model_inspect_package(path.clone()).await?;
    if !inspect.compatible {
        return Err(format!(
            "Package is not compatible: {}",
            inspect.warnings.join("; ")
        ));
    }

    // Step 2: Determine target directory from manifest
    let category = inspect
        .manifest
        .get("category")
        .or_else(|| inspect.manifest.get("task"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let variant = inspect
        .manifest
        .get("name")
        .or_else(|| inspect.manifest.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Validate names for path traversal
    validate_model_name(category)?;
    validate_model_name(variant)?;

    let dest_dir = state.paths.models.join(category).join(variant);

    // Step 3: Remove existing installation if present
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)
            .map_err(|e| format!("Cannot remove existing model: {e}"))?;
    }
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Cannot create model directory: {e}"))?;

    // Step 4: Extract package with path traversal protection
    let file = std::fs::File::open(p).map_err(|e| format!("Cannot open package: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Cannot read package: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Cannot read entry {i}: {e}"))?;

        let out_path = match entry.enclosed_name() {
            Some(p) => dest_dir.join(p),
            None => continue,
        };

        // Validate the resolved path stays within dest_dir
        if !out_path.starts_with(&dest_dir) {
            log::warn!("[Models] Rejected path traversal: {:?}", out_path);
            continue;
        }

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

    log::info!("[Models] Installed {category}/{variant}");

    // Step 5: Rebuild recognition service
    #[cfg(feature = "recognition")]
    {
        if let Err(e) = state.rebuild_service().await {
            log::warn!("[Models] Service rebuild after install failed: {e}");
            return Ok(ModelOperationResult {
                success: true,
                message: format!(
                    "Model '{category}/{variant}' installed but service rebuild failed: {e}. \
                     Restart the application to use it."
                ),
            });
        }
    }

    Ok(ModelOperationResult {
        success: true,
        message: format!("Model '{category}/{variant}' installed successfully."),
    })
}

/// Remove an installed model.
#[tauri::command]
pub async fn model_remove(
    state: State<'_, RecognitionState>,
    model_id: String,
) -> Result<ModelOperationResult, String> {
    // model_id is "category/variant"
    let parts: Vec<&str> = model_id.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid model ID '{model_id}'. Expected format: 'category/variant'"
        ));
    }
    validate_model_name(parts[0])?;
    validate_model_name(parts[1])?;

    let model_dir = state.paths.models.join(parts[0]).join(parts[1]);
    if !model_dir.exists() {
        return Err(format!("Model not found: {model_id}"));
    }

    // Ensure resolved path stays within models directory
    let canonical_base = state
        .paths
        .models
        .canonicalize()
        .map_err(|e| format!("Cannot resolve models directory: {e}"))?;
    let canonical_target = model_dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve model path: {e}"))?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("Path traversal detected".to_string());
    }

    std::fs::remove_dir_all(&model_dir).map_err(|e| format!("Cannot remove model: {e}"))?;

    log::info!("[Models] Removed {model_id}");

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

/// Refresh the model registry and rebuild service.
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

/// Validate a model name component against path traversal.
fn validate_model_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('.')
    {
        return Err(format!(
            "Invalid model name '{name}' — must not contain path separators or '..'"
        ));
    }
    Ok(())
}

/// Extract display info from a parsed Core manifest.
fn extract_manifest_info(loaded: &latexsnipper_model::LoadedModelManifest) -> (String, String, String) {
    match loaded {
        latexsnipper_model::LoadedModelManifest::V2(m) => {
            let name = m
                .categories
                .values()
                .flat_map(|c| &c.variants)
                .map(|v| v.id.clone())
                .next()
                .unwrap_or_else(|| m.source_label.clone());
            (name, m.version.clone(), "onnx".to_string())
        }
        latexsnipper_model::LoadedModelManifest::V3(m) => {
            let name = m
                .categories
                .values()
                .flat_map(|c| &c.profiles)
                .map(|p| p.id.clone())
                .next()
                .unwrap_or_else(|| m.source_label.clone());
            (name, m.version.clone(), "onnx".to_string())
        }
    }
}

/// Detect model format by looking for known artifacts.
fn detect_format(dir: &std::path::Path) -> String {
    if dir.join("model.onnx").exists() {
        "onnx".to_string()
    } else if dir.join("inference.pdmodel").exists() {
        "paddle".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Read a named file from a zip archive.
fn read_archive_file(
    archive: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
) -> Result<String, String> {
    let mut file = archive
        .by_name(name)
        .map_err(|_| format!("Package does not contain {name}"))?;
    let mut buf = String::new();
    std::io::Read::read_to_string(&mut file, &mut buf)
        .map_err(|e| format!("Cannot read {name}: {e}"))?;
    Ok(buf)
}

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
