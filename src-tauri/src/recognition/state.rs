//! Recognition application state.
//!
//! The state is lazily initialized:
//! - `paths` and `jobs` are available immediately.
//! - `service` is created on first access via `service().await`.
//!
//! Service hot-swap: installing models calls `rebuild_service()` which
//! creates a new `RecognitionService` wrapped in `Arc`. In-flight jobs
//! retain their existing `Arc<Service>`, while new jobs use the latest one.

use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

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

    /// Lazily-initialized recognition service.
    #[cfg(feature = "recognition")]
    service: RwLock<Option<Arc<RecognitionService>>>,
}

/// Wrapper around the Core engine that the recognition subsystem uses.
///
/// This is what the spec calls `RecognitionService`. In the current
/// `latexsnipper-engine` API the main orchestrator is `SnipperEngine`.
#[cfg(feature = "recognition")]
pub struct RecognitionService {
    pub engine: latexsnipper_engine::SnipperEngine,
}

impl RecognitionState {
    /// Create a new state with only paths and job manager initialized.
    ///
    /// This does **not** load ONNX Runtime, Paddle, or any model.
    /// Those are initialized lazily when the first recognition is requested.
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
    ///
    /// Uses double-checked locking to avoid creating the service
    /// multiple times under contention.
    pub async fn service(&self) -> Result<Arc<RecognitionService>, String> {
        // Fast path: service already initialized
        {
            let guard = self.service.read().await;
            if let Some(service) = guard.as_ref() {
                return Ok(service.clone());
            }
        }

        // Slow path: need to initialize
        let _init = self.init_lock.lock().await;

        // Check again after acquiring the lock
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

    /// Rebuild the recognition service after model/runtime changes.
    ///
    /// Creates a new `RecognitionService` and swaps it in. Running jobs
    /// keep using the old `Arc<Service>` — they are not interrupted.
    pub async fn rebuild_service(&self) -> Result<(), String> {
        let _guard = self.init_lock.lock().await;

        let new_service = Arc::new(self.create_service()?);

        *self.service.write().await = Some(new_service);

        Ok(())
    }

    /// Create the underlying engine.
    fn create_service(&self) -> Result<RecognitionService, String> {
        use latexsnipper_engine::{default_runtime_registry, EngineConfig};

        let config = EngineConfig::with_models_dir(self.paths.models.clone());

        let registry = default_runtime_registry(&self.paths.models)
            .map_err(|e| format!("Failed to create runtime registry: {e}"))?;

        let engine = latexsnipper_engine::SnipperEngine::with_runtime_registry(config, registry)
            .map_err(|e| format!("Failed to create engine: {e}"))?;

        Ok(RecognitionService { engine })
    }
}
