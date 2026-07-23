//! Model management commands.
//!
//! These commands delegate model lifecycle to Core's runtime ModelManifest
//! and ModelRegistry. Office does NOT maintain its own model manifest format.
//!
//! Core's canonical model directory structure:
//! ```text
//! models/<category>/<variant>/manifest.toml    (TOML, not JSON)
//! ```
//!
//! The `.lsmodel` transport format is a zip containing a single model
//! directory with Core's `manifest.toml` at its root.

use serde::Serialize;
use tauri::State;

use crate::recognition::state::RecognitionState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub task: String,
    pub version: String,
    pub adapter: String,
    pub size_bytes: u64,
    pub loaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInspectResult {
    /// Parsed manifest fields.
    pub id: Option<String>,
    pub task: Option<String>,
    pub version: Option<String>,
    pub adapter: Option<String>,
    pub runtime_variants: Vec<String>,
    pub compatible: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOperationResult {
    pub success: bool,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List installed models by scanning categories/variants.
#[tauri::command]
pub async fn model_list(state: State<'_, RecognitionState>) -> Result<Vec<ModelInfo>, String> {
    let models_dir = &state.paths.models;
    if !models_dir.exists() {
        return Ok(Vec::new());
    }

    let mut models = Vec::new();

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

            let manifest_path = variant_path.join("manifest.toml");
            let (name, task, version, adapter) = if manifest_path.exists() {
                match std::fs::read_to_string(&manifest_path) {
                    Ok(content) => {
                        match toml::from_str::<latexsnipper_runtime::ModelManifest>(&content) {
                            Ok(m) => {
                                let task_str = format!("{:?}", m.task).to_lowercase();
                                (m.id.clone(), task_str, m.version.clone(), m.adapter.clone())
                            }
                            Err(_) => (
                                format!("{category}/{variant}"),
                                "unknown".to_string(),
                                "0.0.0".to_string(),
                                "unknown".to_string(),
                            ),
                        }
                    }
                    Err(_) => (
                        format!("{category}/{variant}"),
                        "unknown".to_string(),
                        "0.0.0".to_string(),
                        "unknown".to_string(),
                    ),
                }
            } else {
                (
                    format!("{category}/{variant}"),
                    "unknown".to_string(),
                    "0.0.0".to_string(),
                    "unknown".to_string(),
                )
            };

            let size_bytes = dir_size(&variant_path).unwrap_or(0);
            let model_id = format!("{category}/{variant}");

            models.push(ModelInfo {
                id: model_id,
                name,
                task,
                version,
                adapter,
                size_bytes,
                loaded: false,
            });
        }
    }

    Ok(models)
}

/// Inspect a .lsmodel package using Core's runtime ModelManifest parser.
#[tauri::command]
pub async fn model_inspect_package(path: String) -> Result<ModelInspectResult, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("Package file does not exist: {path}"));
    }

    let file = std::fs::File::open(p).map_err(|e| format!("Cannot open package: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Cannot read package: {e}"))?;

    // Look for manifest.toml (Core TOML format)
    let manifest_content = read_archive_file(&mut archive, "manifest.toml")?;

    let mut warnings = Vec::new();

    match toml::from_str::<latexsnipper_runtime::ModelManifest>(&manifest_content) {
        Ok(manifest) => {
            let compatible = manifest.validate().is_ok();

            if let Err(e) = manifest.validate() {
                warnings.push(format!("Validation: {e}"));
            }

            let runtime_variants: Vec<String> = manifest
                .runtime_variants
                .iter()
                .map(|v| v.id.clone())
                .collect();

            Ok(ModelInspectResult {
                id: Some(manifest.id),
                task: Some(format!("{:?}", manifest.task).to_lowercase()),
                version: Some(manifest.version),
                adapter: Some(manifest.adapter),
                runtime_variants,
                compatible,
                warnings,
            })
        }
        Err(e) => Ok(ModelInspectResult {
            id: None,
            task: None,
            version: None,
            adapter: None,
            runtime_variants: vec![],
            compatible: false,
            warnings: vec![format!("TOML parse failed: {e}")],
        }),
    }
}

/// Import a .lsmodel package.
#[tauri::command]
pub async fn model_import_package(
    state: State<'_, RecognitionState>,
    path: String,
) -> Result<ModelOperationResult, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("Package file does not exist: {path}"));
    }

    // Step 1: Inspect
    let inspect = model_inspect_package(path.clone()).await?;
    if !inspect.compatible {
        return Err(format!(
            "Package is not compatible: {}",
            inspect.warnings.join("; ")
        ));
    }

    // Step 2: Determine target from manifest.id (category/variant)
    let model_id = inspect.id.ok_or("Manifest has no id field")?;
    let parts: Vec<&str> = model_id.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid manifest id '{model_id}'. Expected 'category/variant'."
        ));
    }
    let (category, variant) = (parts[0], parts[1]);
    validate_model_name(category)?;
    validate_model_name(variant)?;

    let staging_dir = state
        .paths
        .models
        .join(".staging")
        .join(&model_id.replace('/', "_"));
    let dest_dir = state.paths.models.join(category).join(variant);

    // Step 3: Extract to staging first
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir).map_err(|e| format!("Cannot clean staging: {e}"))?;
    }
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Cannot create staging directory: {e}"))?;

    let file = std::fs::File::open(p).map_err(|e| format!("Cannot open package: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Cannot read package: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Cannot read entry {i}: {e}"))?;
        let out_path = match entry.enclosed_name() {
            Some(p) => staging_dir.join(p),
            None => continue,
        };
        if !out_path.starts_with(&staging_dir) {
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
            let mut outfile =
                std::fs::File::create(&out_path).map_err(|e| format!("Cannot create file: {e}"))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Cannot extract file: {e}"))?;
        }
    }

    // Step 4: Validate manifest.toml from staging
    let staging_manifest = staging_dir.join("manifest.toml");
    if !staging_manifest.exists() {
        std::fs::remove_dir_all(&staging_dir).ok();
        return Err("Package does not contain manifest.toml".to_string());
    }
    let manifest_content = std::fs::read_to_string(&staging_manifest)
        .map_err(|e| format!("Cannot read manifest: {e}"))?;
    let manifest: latexsnipper_runtime::ModelManifest =
        toml::from_str(&manifest_content).map_err(|e| format!("Invalid manifest.toml: {e}"))?;
    manifest
        .validate()
        .map_err(|e| format!("Manifest validation failed: {e}"))?;

    // Step 5: Move from staging to final location
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)
            .map_err(|e| format!("Cannot remove existing model: {e}"))?;
    }
    std::fs::create_dir_all(dest_dir.parent().unwrap())
        .map_err(|e| format!("Cannot create category directory: {e}"))?;
    std::fs::rename(&staging_dir, &dest_dir)
        .map_err(|e| format!("Cannot move model to final location: {e}"))?;

    log::info!("[Models] Installed {category}/{variant}");

    // Step 6: Rebuild service
    #[cfg(feature = "recognition")]
    {
        if let Err(e) = state.rebuild_service().await {
            log::warn!("[Models] Service rebuild after install failed: {e}");
            return Ok(ModelOperationResult {
                success: true,
                message: format!(
                    "Model '{category}/{variant}' installed but service rebuild failed: {e}."
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
    let parts: Vec<&str> = model_id.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid model ID '{model_id}'. Expected 'category/variant'."
        ));
    }
    validate_model_name(parts[0])?;
    validate_model_name(parts[1])?;

    let model_dir = state.paths.models.join(parts[0]).join(parts[1]);
    if !model_dir.exists() {
        return Err(format!("Model not found: {model_id}"));
    }

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

/// Refresh the model registry.
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

fn validate_model_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name == "."
    {
        return Err(format!("Invalid model name '{name}'."));
    }
    Ok(())
}

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
