//! Recognition application state.
//!
//! The state is lazily initialized:
//! - `paths` and `jobs` are available immediately.
//! - `service` is created on first access via `service().await`.
//!
//! Service hot-swap: installing models calls `rebuild_service()` which
//! creates a new `RecognitionService` wrapped in `Arc`. In-flight jobs
//! retain their existing `Arc<Service>`, while new jobs use the latest one.
//!
//! Per-job model overrides: when a RecognitionStartRequest specifies
//! model_overrides, a temporary engine is built with those overrides.
//! The shared engine is NOT affected.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use super::dto::RecognitionStartRequest;
use super::jobs::RecognitionJobManager;
use super::paths::RecognitionPaths;

/// Central recognition state, managed by Tauri.
pub struct RecognitionState {
    /// Resolved filesystem paths.
    pub paths: RecognitionPaths,

    /// Job manager (always available).
    pub jobs: Arc<RecognitionJobManager>,

    /// Ensures service initialization happens only once at a time.
    init_lock: Mutex<()>,

    /// Lazily-initialized recognition service (shared, no overrides).
    #[cfg(feature = "recognition")]
    service: RwLock<Option<Arc<RecognitionService>>>,
}

/// Wrapper around the Core engine.
#[cfg(feature = "recognition")]
pub struct RecognitionService {
    pub engine: latexsnipper_engine::SnipperEngine,
    /// Models directory used to build this engine.
    models_dir: PathBuf,
}

#[cfg(feature = "recognition")]
impl RecognitionService {
    /// Recognize an image or PDF through the managed engine.
    ///
    /// Respects `mode`, `parse_mode`, and `model_overrides` from the request.
    /// For per-job model overrides a temporary engine is built.
    pub async fn recognize(
        &self,
        path: &Path,
        request: &RecognitionStartRequest,
    ) -> Result<latexsnipper_ast::Document, String> {
        use latexsnipper_engine::RecognizeMode;
        use latexsnipper_image::decode::{decode, ImageSource};

        let mode = parse_recognize_mode(&request.mode)?;

        let is_pdf = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);

        if request.model_overrides.is_some() {
            let temp_engine = self.build_engine_with_overrides(request)?;
            run_recognition(&temp_engine, path, mode, is_pdf).await
        } else {
            run_recognition(&self.engine, path, mode, is_pdf).await
        }
    }

    /// Build a temporary engine with per-job model overrides.
    fn build_engine_with_overrides(
        &self,
        request: &RecognitionStartRequest,
    ) -> Result<latexsnipper_engine::SnipperEngine, String> {
        use latexsnipper_engine::{default_runtime_registry, EngineConfig};

        let mut config = EngineConfig::with_models_dir(self.models_dir.clone());

        if let Some(ref overrides) = request.model_overrides {
            if let Some(ref v) = overrides.formula_det {
                config = config.set_formula_det(v);
            }
            if let Some(ref v) = overrides.formula_rec {
                config = config.set_formula_rec(v);
            }
            if let Some(ref v) = overrides.text_det {
                config = config.set_text_det(v);
            }
            if let Some(ref v) = overrides.text_rec {
                config = config.set_text_rec(v);
            }
            if let Some(ref v) = overrides.table_det {
                config = config.set_table_det(v);
            }
            if let Some(ref v) = overrides.table_struct {
                config = config.set_table_struct(v);
            }
        }

        if let Some(ref pm) = request.parse_mode {
            if let Some(parsed) = parse_document_mode(pm) {
                config = config.set_parse_mode(parsed);
            }
        }

        let registry = default_runtime_registry(&self.models_dir)
            .map_err(|e| format!("Failed to create runtime registry: {e}"))?;

        latexsnipper_engine::SnipperEngine::with_runtime_registry(config, registry)
            .map_err(|e| format!("Failed to create override engine: {e}"))
    }
}

/// Shared recognition execution: decode image/PDF and run through engine.
#[cfg(feature = "recognition")]
async fn run_recognition(
    engine: &latexsnipper_engine::SnipperEngine,
    path: &Path,
    mode: latexsnipper_engine::RecognizeMode,
    is_pdf: bool,
) -> Result<latexsnipper_ast::Document, String> {
    if is_pdf {
        engine
            .recognize_pdf(path, mode)
            .await
            .map_err(|e| format!("PDF recognition failed: {e}"))
    } else {
        use latexsnipper_image::decode::{decode, ImageSource};
        let img = decode(ImageSource::File(path))
            .map_err(|e| format!("Image decode failed: {e}"))?;

        engine
            .recognize(img, mode)
            .await
            .map_err(|e| format!("Recognition failed: {e}"))
    }
}

impl RecognitionState {
    pub fn new(paths: RecognitionPaths) -> Self {
        Self {
            paths,
            jobs: Arc::new(RecognitionJobManager::new()),
            init_lock: Mutex::new(()),
            #[cfg(feature = "recognition")]
            service: RwLock::new(None),
        }
    }
}

#[cfg(feature = "recognition")]
impl RecognitionState {
    /// Get (or lazily create) the recognition service.
    pub async fn service(&self) -> Result<Arc<RecognitionService>, String> {
        {
            let guard = self.service.read().await;
            if let Some(service) = guard.as_ref() {
                return Ok(service.clone());
            }
        }
        let _init = self.init_lock.lock().await;
        {
            let guard = self.service.read().await;
            if let Some(service) = guard.as_ref() {
                return Ok(service.clone());
            }
        }
        let service = Arc::new(self.create_service()?);
        *self.service.write().await = Some(service.clone());
        Ok(service)
    }

    /// Rebuild after model/runtime changes.
    pub async fn rebuild_service(&self) -> Result<(), String> {
        let _guard = self.init_lock.lock().await;
        let new_service = Arc::new(self.create_service()?);
        *self.service.write().await = Some(new_service);
        Ok(())
    }

    fn create_service(&self) -> Result<RecognitionService, String> {
        use latexsnipper_engine::{default_runtime_registry, EngineConfig};

        let models_dir = self.paths.models.clone();
        let config = EngineConfig::with_models_dir(models_dir.clone());
        let registry = default_runtime_registry(&models_dir)
            .map_err(|e| format!("Failed to create runtime registry: {e}"))?;
        let engine = latexsnipper_engine::SnipperEngine::with_runtime_registry(config, registry)
            .map_err(|e| format!("Failed to create engine: {e}"))?;

        Ok(RecognitionService {
            engine,
            models_dir,
        })
    }
}

// ---------------------------------------------------------------------------
// Mode parsing
// ---------------------------------------------------------------------------

#[cfg(feature = "recognition")]
fn parse_recognize_mode(s: &str) -> Result<latexsnipper_engine::RecognizeMode, String> {
    match s {
        "auto" | "mixed" | "full-document" => Ok(latexsnipper_engine::RecognizeMode::Mixed),
        "formula" => Ok(latexsnipper_engine::RecognizeMode::Formula),
        "text" => Ok(latexsnipper_engine::RecognizeMode::Text),
        "table" => Ok(latexsnipper_engine::RecognizeMode::Table),
        "handwriting" => Ok(latexsnipper_engine::RecognizeMode::Handwriting),
        "formula-layout" => Ok(latexsnipper_engine::RecognizeMode::FormulaLayout),
        other => Err(format!(
            "Unknown recognition mode '{other}'. \
             Valid: auto, formula, text, table, handwriting, formula-layout"
        )),
    }
}

#[cfg(feature = "recognition")]
fn parse_document_mode(s: &str) -> Option<latexsnipper_pipeline::DocumentParseMode> {
    match s {
        "specialized" | "stable" => Some(latexsnipper_pipeline::DocumentParseMode::SpecializedStable),
        "openocr" | "openocr-text" => Some(latexsnipper_pipeline::DocumentParseMode::OpenOcrText),
        "opendoc" | "hybrid" => Some(latexsnipper_pipeline::DocumentParseMode::OpenDocHybrid),
        _ => None,
    }
}
