//! Recognition job system.
//!
//! Each job has:
//! - A unique ID
//! - A status snapshot (queried by the frontend)
//! - A cancellation token
//! - (when recognition feature is enabled) a result slot
//!
//! Jobs are stored in `RecognitionJobManager` and accessed by ID.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

#[cfg(feature = "recognition")]
use latexsnipper_ast::Document;

// ---------------------------------------------------------------------------
// Job status & stage
// ---------------------------------------------------------------------------

/// Lifecycle status of a recognition job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecognitionJobStatus {
    /// Waiting to be picked up.
    Queued,
    /// Currently executing.
    Running,
    /// User requested cancellation; waiting for the current stage to finish.
    CancelRequested,
    /// Successfully completed.
    Completed,
    /// Finished with an error.
    Failed,
    /// Successfully cancelled.
    Cancelled,
}

/// Fine-grained stage within a running job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecognitionStage {
    Preparing,
    LoadingModels,
    RenderingPdf,
    DetectingLayout,
    DetectingText,
    DetectingFormula,
    DetectingTable,
    RecognizingText,
    RecognizingFormula,
    RecognizingTable,
    Postprocessing,
    Converting,
    Completed,
}

/// A point-in-time snapshot of a job's progress.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionJobSnapshot {
    /// Unique job identifier.
    pub id: String,

    /// Current lifecycle status.
    pub status: RecognitionJobStatus,

    /// Current execution stage.
    pub stage: RecognitionStage,

    /// Progress fraction (0.0 – 1.0).
    pub progress: f32,

    /// Current page (for multi-page documents).
    pub current_page: Option<u32>,

    /// Total pages (for multi-page documents).
    pub total_pages: Option<u32>,

    /// Human-readable status message.
    pub message: Option<String>,

    /// Error message (if status == Failed).
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Job entry
// ---------------------------------------------------------------------------

/// A single recognition job.
pub struct RecognitionJobEntry {
    /// Mutable snapshot updated by the worker.
    pub snapshot: RwLock<RecognitionJobSnapshot>,

    /// Token to signal cancellation.
    pub cancellation: CancellationToken,

    /// Recognition result (available after completion).
    #[cfg(feature = "recognition")]
    pub result: RwLock<Option<Arc<RecognitionResult>>>,
}

/// The result of a completed recognition job.
#[cfg(feature = "recognition")]
pub struct RecognitionResult {
    /// The parsed document AST.
    pub document: Document,
}

// ---------------------------------------------------------------------------
// Job manager
// ---------------------------------------------------------------------------

/// Thread-safe registry of all recognition jobs.
pub struct RecognitionJobManager {
    jobs: RwLock<HashMap<String, Arc<RecognitionJobEntry>>>,
}

impl RecognitionJobManager {
    /// Create an empty job manager.
    pub fn new() -> Self {
        Self {
            jobs: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new job and return it.
    pub async fn create(&self) -> Arc<RecognitionJobEntry> {
        let id = generate_job_id();
        let entry = Arc::new(RecognitionJobEntry {
            snapshot: RwLock::new(RecognitionJobSnapshot {
                id: id.clone(),
                status: RecognitionJobStatus::Queued,
                stage: RecognitionStage::Preparing,
                progress: 0.0,
                current_page: None,
                total_pages: None,
                message: Some("Job created".to_string()),
                error: None,
            }),
            cancellation: CancellationToken::new(),
            #[cfg(feature = "recognition")]
            result: RwLock::new(None),
        });

        self.jobs.write().await.insert(id, entry.clone());
        entry
    }

    /// Retrieve a job by ID.
    pub async fn get(&self, id: &str) -> Option<Arc<RecognitionJobEntry>> {
        self.jobs.read().await.get(id).cloned()
    }

    /// Request cancellation of a job.
    ///
    /// Returns `true` if the job was found and a cancellation request was
    /// issued. The job will finish its current stage before stopping.
    pub async fn cancel(&self, id: &str) -> bool {
        if let Some(job) = self.jobs.read().await.get(id) {
            job.cancellation.cancel();
            // Update status
            let mut snap = job.snapshot.write().await;
            if snap.status == RecognitionJobStatus::Queued
                || snap.status == RecognitionJobStatus::Running
            {
                snap.status = RecognitionJobStatus::CancelRequested;
                snap.message = Some("Cancelling...".to_string());
            }
            true
        } else {
            false
        }
    }

    /// Remove a completed/cancelled/failed job from the registry.
    pub async fn remove(&self, id: &str) -> bool {
        self.jobs.write().await.remove(id).is_some()
    }

    /// Get a snapshot of every registered job.
    pub async fn list_snapshots(&self) -> Vec<RecognitionJobSnapshot> {
        let jobs = self.jobs.read().await;
        let mut snapshots = Vec::with_capacity(jobs.len());
        for job in jobs.values() {
            snapshots.push(job.snapshot.read().await.clone());
        }
        snapshots
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate a unique job ID using timestamp + random suffix.
fn generate_job_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let suffix: u16 = rand::random();
    format!("job-{:x}-{:04x}", t, suffix)
}
