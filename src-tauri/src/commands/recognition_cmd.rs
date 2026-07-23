//! Recognition commands — Tauri IPC entry points for the recognition subsystem.

use std::path::PathBuf;
use tauri::Emitter;
use tauri::State;

use crate::recognition::dto::*;
use crate::recognition::jobs::*;
use crate::recognition::state::RecognitionState;
use crate::recognition::validation;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Query what the recognition backend supports.
#[tauri::command]
pub async fn recognition_get_capabilities() -> Result<RecognitionCapabilities, String> {
    #[cfg(feature = "recognition")]
    {
        Ok(RecognitionCapabilities {
            available: true,
            modes: vec![
                "auto".to_string(),
                "formula".to_string(),
                "text".to_string(),
                "table".to_string(),
                "full-document".to_string(),
            ],
            output_formats: vec![
                "markdown".to_string(),
                "latex".to_string(),
                "typst".to_string(),
                "html".to_string(),
                "omml".to_string(),
                "json".to_string(),
            ],
            max_resolution: Some(4096),
            active_jobs: 0,
        })
    }

    #[cfg(not(feature = "recognition"))]
    {
        Ok(RecognitionCapabilities {
            available: false,
            modes: vec![],
            output_formats: vec![],
            max_resolution: None,
            active_jobs: 0,
        })
    }
}

/// Start a new recognition job.
#[tauri::command]
pub async fn recognition_start(
    app: tauri::AppHandle,
    state: State<'_, RecognitionState>,
    request: RecognitionStartRequest,
) -> Result<RecognitionStartResponse, String> {
    // Validate input
    validation::validate_input_path(&request.path)?;
    validation::validate_mode(&request.mode)?;

    #[cfg(not(feature = "recognition"))]
    {
        let _ = (app, state, request);
        return Err("Recognition is not included in this build. \
             Rebuild with the recognition feature."
            .to_string());
    }

    #[cfg(feature = "recognition")]
    {
        // Create a new job entry
        let job = state.jobs.create().await;
        let job_id = {
            let snap = job.snapshot.read().await;
            snap.id.clone()
        };

        // Set initial state
        {
            let mut snap = job.snapshot.write().await;
            snap.status = RecognitionJobStatus::Queued;
            snap.stage = RecognitionStage::Preparing;
            snap.message = Some("Preparing recognition...".to_string());
        }

        // Emit initial state
        emit_job_update(&app, &*job.snapshot.read().await);

        // Get the recognition service (lazy-init if needed)
        let service = state.service().await?;

        // Spawn the job
        let app_clone = app.clone();
        let path = PathBuf::from(&request.path);

        tauri::async_runtime::spawn(async move {
            run_recognition_job(app_clone, service, job, path, request).await;
        });

        Ok(RecognitionStartResponse { job_id })
    }
}

/// Get the current snapshot of a single job.
#[tauri::command]
pub async fn recognition_get_job(
    state: State<'_, RecognitionState>,
    job_id: String,
) -> Result<Option<RecognitionJobSnapshot>, String> {
    if let Some(job) = state.jobs.get(&job_id).await {
        Ok(Some(job.snapshot.read().await.clone()))
    } else {
        Ok(None)
    }
}

/// Get all job snapshots.
#[tauri::command]
pub async fn recognition_list_jobs(
    state: State<'_, RecognitionState>,
) -> Result<Vec<RecognitionJobSnapshot>, String> {
    Ok(state.jobs.list_snapshots().await)
}

/// Request cancellation of a running job.
#[tauri::command]
pub async fn recognition_cancel(
    state: State<'_, RecognitionState>,
    job_id: String,
) -> Result<bool, String> {
    Ok(state.jobs.cancel(&job_id).await)
}

/// Get the output of a completed job in the requested format.
#[tauri::command]
pub async fn recognition_get_output(
    state: State<'_, RecognitionState>,
    request: GetOutputRequest,
) -> Result<GetOutputResponse, String> {
    validation::validate_output_format(&request.format)?;

    #[cfg(not(feature = "recognition"))]
    {
        let _ = (state, request);
        return Ok(GetOutputResponse {
            success: false,
            content: None,
            error: Some("Recognition is not included in this build.".to_string()),
        });
    }

    #[cfg(feature = "recognition")]
    {
        let job = state
            .jobs
            .get(&request.job_id)
            .await
            .ok_or_else(|| format!("Job not found: {}", request.job_id))?;

        // Check the job is completed
        {
            let snap = job.snapshot.read().await;
            if snap.status != RecognitionJobStatus::Completed {
                return Ok(GetOutputResponse {
                    success: false,
                    content: None,
                    error: Some(format!("Job is not completed (status: {:?})", snap.status)),
                });
            }
        }

        // Get the recognition result
        let result = job.result.read().await;
        let result = result
            .as_ref()
            .ok_or_else(|| "Job result is empty".to_string())?;

        // Convert to the requested format
        let content = convert_document_to_format(&result.document, &request.format)?;

        Ok(GetOutputResponse {
            success: true,
            content: Some(content),
            error: None,
        })
    }
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

#[cfg(feature = "recognition")]
async fn run_recognition_job(
    app: tauri::AppHandle,
    service: std::sync::Arc<crate::recognition::state::RecognitionService>,
    job: std::sync::Arc<RecognitionJobEntry>,
    path: PathBuf,
    request: RecognitionStartRequest,
) {
    // Transition to Running
    {
        let mut snap = job.snapshot.write().await;
        snap.status = RecognitionJobStatus::Running;
        snap.stage = RecognitionStage::LoadingModels;
        snap.message = Some(format!("Loading models (mode={})...", request.mode));
    }
    emit_job_update(&app, &*job.snapshot.read().await);

    // Check cancellation before starting
    if job.cancellation.is_cancelled() {
        finish_cancelled(&app, &job);
        return;
    }

    let mode_label = request.mode.clone();
    log::info!(
        "[Recognition] Starting job {} mode={mode_label} path={}",
        job.snapshot.read().await.id,
        path.display()
    );

    let result = {
        let mut snap = job.snapshot.write().await;
        snap.stage = RecognitionStage::RecognizingFormula;
        snap.message = Some(format!("Recognizing ({mode_label})..."));
        drop(snap);

        // Route through managed RecognitionService (NOT raw Snipper::from_file)
        service.recognize(&path, &request).await
    };

    // Check cancellation
    if job.cancellation.is_cancelled() {
        finish_cancelled(&app, &job);
        return;
    }

    match result {
        Ok(document) => {
            // Store result
            *job.result.write().await = Some(std::sync::Arc::new(
                crate::recognition::jobs::RecognitionResult { document },
            ));

            // Transition to Completed
            {
                let mut snap = job.snapshot.write().await;
                snap.status = RecognitionJobStatus::Completed;
                snap.stage = RecognitionStage::Completed;
                snap.progress = 1.0;
                snap.message = Some("Recognition complete".to_string());
            }
            emit_job_update(&app, &*job.snapshot.read().await);

            log::info!(
                "[Recognition] Job {} completed successfully",
                job.snapshot.read().await.id
            );
        }
        Err(error) => {
            // Transition to Failed
            {
                let mut snap = job.snapshot.write().await;
                snap.status = RecognitionJobStatus::Failed;
                snap.error = Some(error.clone());
                snap.message = Some("Recognition failed".to_string());
            }
            emit_job_update(&app, &*job.snapshot.read().await);

            log::error!(
                "[Recognition] Job {} failed: {error}",
                job.snapshot.read().await.id
            );
        }
    }
}

#[cfg(feature = "recognition")]
fn finish_cancelled(app: &tauri::AppHandle, job: &RecognitionJobEntry) {
    let mut snap = loop {
        if let Ok(s) = job.snapshot.try_write() {
            break s;
        }
    };
    snap.status = RecognitionJobStatus::Cancelled;
    snap.message = Some("Cancelled".to_string());
    emit_job_update(app, &snap);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Emit a job-updated event to the frontend via `recognition://job-updated`.
fn emit_job_update(app: &tauri::AppHandle, snapshot: &RecognitionJobSnapshot) {
    let _ = app.emit("recognition://job-updated", snapshot);
}

/// Convert a document to the requested output format.
#[cfg(feature = "recognition")]
fn convert_document_to_format(
    document: &latexsnipper_ast::Document,
    format: &str,
) -> Result<String, String> {
    use latexsnipper_conversion::{DocumentConverter, OutputFormat};

    let output_format = match format {
        "markdown" => OutputFormat::MarkdownBlock,
        "latex" => OutputFormat::Latex,
        "typst" => OutputFormat::Typst,
        "html" => OutputFormat::Html,
        "omml" => OutputFormat::OMML,
        "json" => {
            return serde_json::to_string_pretty(document)
                .map_err(|e| format!("JSON serialization failed: {e}"));
        }
        other => return Err(format!("Unsupported output format: {other}")),
    };

    DocumentConverter::new(output_format)
        .convert(document)
        .map_err(|e| format!("Conversion failed: {e}"))
}

#[cfg(not(feature = "recognition"))]
fn convert_document_to_format(_document: &(), _format: &str) -> Result<String, String> {
    Err("Recognition is not included in this build.".to_string())
}
