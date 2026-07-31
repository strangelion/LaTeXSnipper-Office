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
pub async fn recognition_get_capabilities(
    state: State<'_, RecognitionState>,
) -> Result<RecognitionCapabilities, String> {
    #[cfg(feature = "recognition")]
    {
        let job_count = state.jobs.list_snapshots().await.len();
        Ok(RecognitionCapabilities {
            available: true,
            modes: validation::supported_modes(),
            output_formats: validation::supported_output_formats(),
            max_resolution: Some(4096),
            active_jobs: job_count,
        })
    }

    #[cfg(not(feature = "recognition"))]
    {
        let _ = state;
        Ok(RecognitionCapabilities {
            available: false,
            modes: vec![],
            output_formats: vec![],
            max_resolution: None,
            active_jobs: 0,
        })
    }
}

/// Return the authoritative Core readiness contract without duplicating
/// runtime/model/provider interpretation in the Office application.
#[cfg(feature = "recognition")]
#[tauri::command]
pub async fn recognition_get_readiness(
    state: State<'_, RecognitionState>,
) -> Result<latexsnipper_api_types::EngineReadiness, String> {
    state.core_readiness().await
}

#[cfg(feature = "recognition")]
#[tauri::command]
pub async fn recognition_validate_provider(
    state: State<'_, RecognitionState>,
    provider: String,
    policy: latexsnipper_api_types::ProviderValidationPolicy,
) -> Result<latexsnipper_api_types::ProviderValidationReport, String> {
    state
        .validate_provider(latexsnipper_api_types::ProviderValidationRequest {
            provider,
            policy,
            key: None,
        })
        .await
}

#[cfg(not(feature = "recognition"))]
#[tauri::command]
pub async fn recognition_get_readiness(
    _state: State<'_, RecognitionState>,
) -> Result<serde_json::Value, String> {
    Err(
        "RECOGNITION_FEATURE_NOT_COMPILED: install a desktop-full build with Core recognition"
            .to_string(),
    )
}

#[cfg(not(feature = "recognition"))]
#[tauri::command]
pub async fn recognition_validate_provider(
    _state: State<'_, RecognitionState>,
    _provider: String,
    _policy: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("RECOGNITION_FEATURE_NOT_COMPILED: provider validation requires desktop-full".to_string())
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
    validation::validate_input_kind(request.input_kind.as_deref())?;
    // Reject unsupported execution policies (only "async" is valid v1)
    validation::validate_execution_policy(request.execution_policy.as_deref())?;
    // Validate parse_mode early so we fail before creating a job
    if let Some(ref pm) = request.parse_mode {
        // parse_document_mode is called inside recognize(), but we validate early
        validate_parse_mode_precheck(pm)?;
    }

    #[cfg(not(feature = "recognition"))]
    {
        let _ = (app, state, request);
        return Err("Recognition is not included in this build. \
             Rebuild with the recognition feature."
            .to_string());
    }

    #[cfg(feature = "recognition")]
    {
        let path = PathBuf::from(&request.path);
        let screenshot_job_lease =
            crate::screenshot::lease::ScreenshotJobLeaseGuard::acquire(&path);

        // Resolve Core before publishing a queued job. If readiness/service
        // initialization fails, dropping the guard still releases screenshot
        // input owned by this process.
        let service = state.service().await?;

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

        // Spawn the job
        let app_clone = app.clone();

        tauri::async_runtime::spawn(async move {
            run_recognition_job(app_clone, service, job, path, request, screenshot_job_lease).await;
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
            acceptance: None,
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
                    acceptance: None,
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
        let readiness = state.core_readiness().await?;
        let acceptance =
            build_recognition_acceptance(&result.document, &result.mode, &content, &readiness);

        Ok(GetOutputResponse {
            success: true,
            content: Some(content),
            error: None,
            acceptance: Some(acceptance),
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
    mut screenshot_job_lease: crate::screenshot::lease::ScreenshotJobLeaseGuard,
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
        let _ = screenshot_job_lease.cancel();
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
        // Set stage based on actual mode, not hard-coded "RecognizingFormula"
        snap.stage = match mode_label.as_str() {
            "formula" => RecognitionStage::RecognizingFormula,
            "text" => RecognitionStage::RecognizingText,
            "table" => RecognitionStage::RecognizingTable,
            _ => RecognitionStage::DetectingLayout,
        };
        snap.message = Some(format!("Recognizing ({mode_label})..."));
        drop(snap);

        // Route through managed RecognitionService (NOT raw Snipper::from_file)
        service.recognize(&path, &request).await
    };

    // Check cancellation
    if job.cancellation.is_cancelled() {
        finish_cancelled(&app, &job);
        let _ = screenshot_job_lease.cancel();
        return;
    }

    match result {
        Ok(document) => {
            let mode = request
                .input_kind
                .clone()
                .unwrap_or_else(|| request.mode.clone());
            // Store result
            *job.result.write().await = Some(std::sync::Arc::new(
                crate::recognition::jobs::RecognitionResult { document, mode },
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
            let _ = screenshot_job_lease.complete();
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
            let _ = screenshot_job_lease.fail();
        }
    }
}

#[cfg(feature = "recognition")]
fn build_recognition_acceptance(
    document: &latexsnipper_ast::Document,
    mode_name: &str,
    output: &str,
    readiness: &latexsnipper_api_types::EngineReadiness,
) -> RecognitionAcceptanceDto {
    use latexsnipper_api_types::{ModelQualityStatus, RecognitionAcceptance, RecognitionAction};

    let report = latexsnipper_ast::DocumentReport::from_document(document);
    let mode = readiness.modes.iter().find(|mode| mode.mode == mode_name);
    let technically_valid = mode.is_some_and(|mode| mode.technical_ready);
    let quality_status = mode
        .map(|mode| mode_quality_status(mode, readiness))
        .unwrap_or(ModelQualityStatus::Unknown);
    let confidence = report.confidence_summary.min.unwrap_or(0.0);
    let parse_valid = !output.trim().is_empty();
    let structure_valid = if mode_name == "cropped-formula" {
        report.block_summary.formulas == 1
    } else {
        report.block_summary.total > 0
    };
    let review_required = document
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "POSTPROCESS_REVIEW_REQUIRED");
    let acceptance = RecognitionAcceptance::decide(
        technically_valid,
        quality_status,
        confidence,
        parse_valid,
        structure_valid,
        review_required,
    );

    RecognitionAcceptanceDto {
        technically_valid: acceptance.technically_valid,
        quality_status: quality_status_name(acceptance.quality_status).to_string(),
        confidence: acceptance.confidence,
        parse_valid: acceptance.parse_valid,
        structure_valid: acceptance.structure_valid,
        review_required: acceptance.review_required,
        recommended_action: match acceptance.recommended_action {
            RecognitionAction::AutoAccept => "autoAccept",
            RecognitionAction::RequireReview => "requireReview",
            RecognitionAction::Reject => "reject",
        }
        .to_string(),
        reasons: acceptance
            .reasons
            .into_iter()
            .map(|reason| reason.as_str().to_string())
            .collect(),
    }
}

#[cfg(feature = "recognition")]
fn mode_quality_status(
    mode: &latexsnipper_api_types::ModeReadiness,
    readiness: &latexsnipper_api_types::EngineReadiness,
) -> latexsnipper_api_types::ModelQualityStatus {
    use latexsnipper_api_types::ModelQualityStatus;

    let mut statuses = mode.tasks.iter().filter_map(|task| {
        let selected = task.selected_model.as_deref()?;
        readiness
            .models
            .iter()
            .find(|model| model.id == selected)
            .map(|model| model.quality_status)
    });
    let Some(first) = statuses.next() else {
        return ModelQualityStatus::Unknown;
    };
    statuses.fold(first, |current, next| {
        if quality_rank(next) < quality_rank(current) {
            next
        } else {
            current
        }
    })
}

#[cfg(feature = "recognition")]
const fn quality_rank(status: latexsnipper_api_types::ModelQualityStatus) -> u8 {
    use latexsnipper_api_types::ModelQualityStatus;
    match status {
        ModelQualityStatus::Unknown => 0,
        ModelQualityStatus::BaselineMissing => 1,
        ModelQualityStatus::BaselineFailed => 0,
        ModelQualityStatus::Experimental => 2,
        ModelQualityStatus::Validated => 3,
    }
}

#[cfg(feature = "recognition")]
const fn quality_status_name(status: latexsnipper_api_types::ModelQualityStatus) -> &'static str {
    use latexsnipper_api_types::ModelQualityStatus;
    match status {
        ModelQualityStatus::Unknown => "unknown",
        ModelQualityStatus::BaselineMissing => "baselineMissing",
        ModelQualityStatus::BaselineFailed => "baselineFailed",
        ModelQualityStatus::Experimental => "experimental",
        ModelQualityStatus::Validated => "validated",
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

/// Pre-check parse_mode before recognition starts (fail early, not mid-job).
#[cfg(feature = "recognition")]
fn validate_parse_mode_precheck(pm: &str) -> Result<(), String> {
    // Re-use the same logic as parse_document_mode but discard the result
    match pm {
        "specialized" | "stable" | "openocr" | "openocr-text" | "opendoc" | "hybrid" => Ok(()),
        other => Err(format!(
            "Unknown parse mode '{other}'. Valid: specialized, openocr, opendoc"
        )),
    }
}

#[cfg(not(feature = "recognition"))]
fn validate_parse_mode_precheck(_pm: &str) -> Result<(), String> {
    Err("Recognition is not included in this build.".to_string())
}

#[cfg(not(feature = "recognition"))]
fn convert_document_to_format(_document: &(), _format: &str) -> Result<String, String> {
    Err("Recognition is not included in this build.".to_string())
}
