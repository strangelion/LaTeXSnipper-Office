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
//! Per-job overrides: when a RecognitionStartRequest specifies
//! parse_mode or model_overrides, a temporary engine is built.
//! The shared engine is NOT affected.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use super::dto::RecognitionStartRequest;
use super::jobs::RecognitionJobManager;
use super::paths::RecognitionPaths;

/// Central recognition state, managed by Tauri.
#[allow(dead_code)]
pub struct RecognitionState {
    /// Resolved filesystem paths.
    pub paths: RecognitionPaths,

    /// Job manager (always available).
    pub jobs: Arc<RecognitionJobManager>,

    /// A timed-out native worker keeps its permit until it actually exits.
    #[cfg(feature = "recognition")]
    pub workers: Arc<tokio::sync::Semaphore>,

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
    /// Explicit trusted quality baseline directory.
    quality_baselines_dir: PathBuf,
    /// Versioned provider smoke fixture deployed from the embedded Core asset.
    provider_smoke_fixture: PathBuf,
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
        cancellation: latexsnipper_pipeline::PipelineCancellationToken,
        timeout: std::time::Duration,
    ) -> Result<latexsnipper_ast::Document, String> {
        let mode = map_request_to_core_mode(request)?;

        let is_pdf = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);

        let needs_custom = request.model_overrides.is_some() || request.parse_mode.is_some();

        if needs_custom {
            let temp_engine = self.build_engine_for_request(request)?;
            run_recognition(&temp_engine, path, mode, is_pdf, cancellation, timeout).await
        } else {
            run_recognition(&self.engine, path, mode, is_pdf, cancellation, timeout).await
        }
    }

    /// Build a temporary engine with per-job overrides (parse_mode + model_overrides).
    fn build_engine_for_request(
        &self,
        request: &RecognitionStartRequest,
    ) -> Result<latexsnipper_engine::SnipperEngine, String> {
        use latexsnipper_engine::{default_runtime_registry, EngineConfig};

        let mut config = EngineConfig::with_models_dir(self.models_dir.clone())
            .with_quality_baselines_dir(self.quality_baselines_dir.clone())
            .with_provider_smoke_fixture(self.provider_smoke_fixture.clone());

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
            config = config.set_parse_mode(parse_document_mode(pm)?);
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
    cancellation: latexsnipper_pipeline::PipelineCancellationToken,
    timeout: std::time::Duration,
) -> Result<latexsnipper_ast::Document, String> {
    if is_pdf {
        engine
            .recognize_pdf(path, mode)
            .await
            .map_err(|e| format!("PDF recognition failed: {e}"))
    } else {
        use latexsnipper_image::decode::{decode, ImageSource};
        let img =
            decode(ImageSource::File(path)).map_err(|e| format!("Image decode failed: {e}"))?;

        engine
            .recognize_controlled(
                img,
                mode,
                engine.config().parse_mode,
                Some(cancellation),
                Some(timeout),
                None,
            )
            .await
            .map_err(|e| format!("Recognition failed: {e}"))
    }
}

impl RecognitionState {
    pub fn new(paths: RecognitionPaths) -> Self {
        Self {
            paths,
            jobs: Arc::new(RecognitionJobManager::new()),
            #[cfg(feature = "recognition")]
            workers: Arc::new(tokio::sync::Semaphore::new(2)),
            init_lock: Mutex::new(()),
            #[cfg(feature = "recognition")]
            service: RwLock::new(None),
        }
    }
}

#[cfg(feature = "recognition")]
impl RecognitionState {
    /// Return the authoritative Core readiness snapshot. Creating the service
    /// resolves manifests and providers but does not warm up a model session.
    pub async fn core_readiness(&self) -> Result<latexsnipper_api_types::EngineReadiness, String> {
        let service = self.service().await?;
        tokio::task::spawn_blocking(move || service.engine.readiness())
            .await
            .map_err(|error| format!("RECOGNITION_READINESS_FAILED: {error}"))
    }

    pub async fn validate_provider(
        &self,
        request: latexsnipper_api_types::ProviderValidationRequest,
    ) -> Result<latexsnipper_api_types::ProviderValidationReport, String> {
        let service = self.service().await?;
        tokio::task::spawn_blocking(move || service.engine.validate_provider(request))
            .await
            .map_err(|error| format!("PROVIDER_VALIDATION_TASK_FAILED: {error}"))?
            .map_err(|error| format!("PROVIDER_VALIDATION_FAILED: {error}"))
    }

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
        let service = Arc::new(self.create_service().await?);
        *self.service.write().await = Some(service.clone());
        Ok(service)
    }

    /// Rebuild after model/runtime changes.
    pub async fn rebuild_service(&self) -> Result<(), String> {
        let _guard = self.init_lock.lock().await;
        let new_service = Arc::new(self.create_service().await?);
        *self.service.write().await = Some(new_service);
        Ok(())
    }

    async fn create_service(&self) -> Result<RecognitionService, String> {
        let paths = self.paths.clone();
        tokio::task::spawn_blocking(move || Self::create_service_sync(&paths))
            .await
            .map_err(|error| format!("RECOGNITION_INIT_FAILED: {error}"))?
    }

    fn create_service_sync(paths: &RecognitionPaths) -> Result<RecognitionService, String> {
        use latexsnipper_engine::{default_runtime_registry, EngineConfig};

        let models_dir = paths.models.clone();
        let quality_baselines_dir = paths.quality_baselines.clone();
        let provider_smoke_fixture = paths.provider_smoke_fixture.clone();
        let config = EngineConfig::with_models_dir(models_dir.clone())
            .with_quality_baselines_dir(quality_baselines_dir.clone())
            .with_provider_smoke_fixture(provider_smoke_fixture.clone());
        let registry = default_runtime_registry(&models_dir)
            .map_err(|e| format!("Failed to create runtime registry: {e}"))?;
        let engine = latexsnipper_engine::SnipperEngine::with_runtime_registry(config, registry)
            .map_err(|e| format!("Failed to create engine: {e}"))?;

        Ok(RecognitionService {
            engine,
            models_dir,
            quality_baselines_dir,
            provider_smoke_fixture,
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
        "cropped-formula" => Ok(latexsnipper_engine::RecognizeMode::CroppedFormula),
        "text" => Ok(latexsnipper_engine::RecognizeMode::Text),
        "table" => Ok(latexsnipper_engine::RecognizeMode::Table),
        "handwriting" => Ok(latexsnipper_engine::RecognizeMode::Handwriting),
        "formula-layout" => Ok(latexsnipper_engine::RecognizeMode::FormulaLayout),
        other => Err(format!(
            "Unknown recognition mode '{other}'. \
             Valid: auto, formula, cropped-formula, text, table, handwriting, formula-layout"
        )),
    }
}

#[cfg(feature = "recognition")]
pub(crate) fn map_input_kind_to_core_mode(
    input_kind: &str,
) -> Result<latexsnipper_engine::RecognizeMode, String> {
    match input_kind {
        "cropped-formula" => Ok(latexsnipper_engine::RecognizeMode::CroppedFormula),
        "page-image" | "document-image" => Ok(latexsnipper_engine::RecognizeMode::Mixed),
        "table-image" => Ok(latexsnipper_engine::RecognizeMode::Table),
        other => Err(format!("Unknown recognition input kind '{other}'")),
    }
}

#[cfg(feature = "recognition")]
fn map_request_to_core_mode(
    request: &RecognitionStartRequest,
) -> Result<latexsnipper_engine::RecognizeMode, String> {
    match request.input_kind.as_deref() {
        Some(input_kind) => map_input_kind_to_core_mode(input_kind),
        None => parse_recognize_mode(&request.mode),
    }
}

#[cfg(feature = "recognition")]
fn parse_document_mode(s: &str) -> Result<latexsnipper_pipeline::DocumentParseMode, String> {
    match s {
        "specialized" | "stable" => Ok(latexsnipper_pipeline::DocumentParseMode::SpecializedStable),
        "openocr" | "openocr-text" => Ok(latexsnipper_pipeline::DocumentParseMode::OpenOcrText),
        "opendoc" | "hybrid" => Ok(latexsnipper_pipeline::DocumentParseMode::OpenDocHybrid),
        other => Err(format!(
            "Unknown parse mode '{other}'. Valid: specialized, openocr, opendoc"
        )),
    }
}

#[cfg(all(test, feature = "recognition"))]
mod real_model_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires explicit local model and image fixtures"]
    async fn real_formula_model_smoke() {
        let models = PathBuf::from(
            std::env::var_os("LATEXSNIPPER_TEST_MODELS").expect("set LATEXSNIPPER_TEST_MODELS"),
        );
        let image = PathBuf::from(
            std::env::var_os("LATEXSNIPPER_TEST_IMAGE").expect("set LATEXSNIPPER_TEST_IMAGE"),
        );
        let root = std::env::temp_dir().join(format!(
            "latexsnipper-recognition-smoke-{}",
            rand::random::<u64>()
        ));
        let state = RecognitionState::new(RecognitionPaths {
            models,
            runtimes: root.join("runtimes"),
            quality_baselines: PathBuf::from("latexsnipper-core/quality/baselines"),
            provider_smoke_fixture: PathBuf::from(
                "latexsnipper-core/contracts/fixtures/provider-smoke-v1.json",
            ),
            cache: root.join("cache"),
            jobs: root.join("jobs"),
            logs: root.join("logs"),
            settings: root.join("settings.json"),
            root,
        });
        let service = state.service().await.unwrap();
        let readiness = state.core_readiness().await.unwrap();
        for model in &readiness.models {
            eprintln!(
                "Model {}: artifacts={} runtime={} code={:?} message={:?}",
                model.id, model.artifacts_valid, model.runtime_resolved, model.code, model.message
            );
        }
        let request = RecognitionStartRequest {
            path: image.to_string_lossy().into_owned(),
            mode: "cropped-formula".into(),
            input_kind: Some("cropped-formula".into()),
            parse_mode: None,
            execution_policy: None,
            model_overrides: None,
        };
        let timeout = std::time::Duration::from_secs(120);
        let runtime = tokio::runtime::Handle::current();
        let start = std::time::Instant::now();
        let document = crate::recognition::execution::supervise(
            tokio_util::sync::CancellationToken::new(),
            timeout,
            move || {
                runtime.block_on(service.recognize(
                    &image,
                    &request,
                    latexsnipper_pipeline::PipelineCancellationToken::new(),
                    timeout,
                ))
            },
        )
        .await
        .expect("real model must return a document, not a timeout or missing-model error");
        let latex = latexsnipper_conversion::DocumentConverter::new(
            latexsnipper_conversion::OutputFormat::Latex,
        )
        .convert(&document)
        .unwrap();
        assert!(
            !latex.trim().is_empty(),
            "real inference returned no formula"
        );
        eprintln!("Real model completed in {:?}: {}", start.elapsed(), latex);
    }
}
