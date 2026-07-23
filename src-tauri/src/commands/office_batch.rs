//! Office batch conversion commands.
//!
//! These commands implement the real Desktop↔VSTO request-response flow:
//!   SCAN_LATEX → await SCAN_LATEX_RESULT
//!   BATCH_CONVERT → await BATCH_CONVERT_RESULT
//!
//! Both commands now require an `OfficeTarget` (host + session + document)
//! so the VSTO host can verify it is operating on the expected document.

#[cfg(target_os = "windows")]
use std::{sync::Arc, time::Duration};

#[cfg(target_os = "windows")]
use tauri::State;

use crate::office_integration::batch_conversion;
use crate::office_integration::dto::*;
#[cfg(target_os = "windows")]
use crate::platforms::{
    office_commit::RequestWaiter,
    pipe_protocol::{self, DesktopMessage},
    session::SessionManager,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}

/// Register waiter, send message, await result with cleanup on all paths.
#[cfg(target_os = "windows")]
async fn send_and_wait(
    waiter: &RequestWaiter,
    session_mgr: &SessionManager,
    request_id: String,
    session_id: &str,
    msg: DesktopMessage,
    timeout_secs: u64,
) -> Result<crate::platforms::office_commit::HostResult, String> {
    let rx = waiter.register(request_id.clone()).await;

    if let Err(e) = session_mgr.send_to_session(session_id, msg).await {
        waiter.cancel(&request_id).await;
        return Err(format!("Send failed: {e}"));
    }

    match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => {
            waiter.cancel(&request_id).await;
            Err("Waiter channel closed".to_string())
        }
        Err(_) => {
            waiter.cancel(&request_id).await;
            Err(format!("Timed out after {timeout_secs}s"))
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Scan the active Office document for LaTeX candidates.
///
/// `target` carries the host, session, and document context — the VSTO host
/// verifies it is operating on the expected document before scanning.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn office_batch_scan_latex(
    session_mgr: State<'_, Arc<SessionManager>>,
    waiter: State<'_, Arc<RequestWaiter>>,
    target: OfficeTarget,
    scope: String,
) -> Result<Vec<LatexCandidate>, String> {
    let request_id = format!("scan-{}", uuid_simple());

    let msg = DesktopMessage::ScanLatex {
        requestId: request_id.clone(),
        sessionId: target.session_id.clone(),
        expectedContextId: Some(target.document_context.clone()),
        scope,
    };

    let result = send_and_wait(
        &waiter,
        &session_mgr,
        request_id,
        &target.session_id,
        msg,
        30,
    )
    .await?;

    if !result.success {
        return Err(result.error.unwrap_or_else(|| "Scan failed".to_string()));
    }

    let candidates: Vec<pipe_protocol::LatexCandidateWire> =
        serde_json::from_value(result.data.ok_or("Missing scan data")?)
            .map_err(|e| format!("Invalid scan result: {e}"))?;

    Ok(candidates
        .into_iter()
        .map(|c| LatexCandidate {
            id: c.id,
            source: c.source,
            normalized_latex: c.normalized_latex,
            location: c.location,
            locator: c.locator,
            source_hash: c.source_hash,
            confidence: c.confidence,
        })
        .collect())
}

/// Build a batch conversion plan from LaTeX candidates.
///
/// The plan captures the `target` so execution can verify document identity
/// without the caller re-supplying it.
#[tauri::command]
pub async fn office_batch_convert_plan(
    target: OfficeTarget,
    candidates: Vec<LatexCandidate>,
) -> Result<BatchConversionPlan, String> {
    let mut plan = batch_conversion::build_conversion_plan(candidates)?;
    plan.target = Some(target);
    Ok(plan)
}

/// Execute a batch conversion plan via the Native Office pipe.
///
/// Uses the `target` stored in the plan to bind every BATCH_CONVERT
/// command to the exact host, session, and document that were scanned.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn office_batch_execute(
    session_mgr: State<'_, Arc<SessionManager>>,
    waiter: State<'_, Arc<RequestWaiter>>,
    plan: BatchConversionPlan,
) -> Result<BatchConversionResult, String> {
    let target = plan
        .target
        .as_ref()
        .ok_or("Plan has no target — was it built by office_batch_convert_plan?")?;

    let plan_id = plan.id.clone();
    let total = plan.items.len();
    let request_id = format!("batch-{}", uuid_simple());

    let msg = DesktopMessage::BatchConvert {
        requestId: request_id.clone(),
        sessionId: target.session_id.clone(),
        expectedContextId: target.document_context.clone(),
        planId: plan_id.clone(),
        plan: serde_json::to_value(&plan).map_err(|e| format!("Serialization failed: {e}"))?,
    };

    // Use send_and_wait for proper cleanup on all paths
    let result = send_and_wait(
        &waiter,
        &session_mgr,
        request_id,
        &target.session_id,
        msg,
        120,
    )
    .await?;

    // Command-level failure (CONTEXT_CHANGED etc) vs item-level partial failure
    if !result.success {
        return Err(result
            .error
            .unwrap_or_else(|| "Batch command failed".to_string()));
    }

    let batch_result: serde_json::Value = result.data.ok_or("Missing batch result data")?;

    Ok(BatchConversionResult {
        total: batch_result["total"].as_u64().unwrap_or(total as u64) as usize,
        converted: batch_result["converted"].as_u64().unwrap_or(0) as usize,
        skipped: batch_result["skipped"].as_u64().unwrap_or(0) as usize,
        failed: batch_result["failed"].as_u64().unwrap_or(0) as usize,
        failures: batch_result["failures"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|f| BatchFailure {
                        source_id: f["sourceId"].as_str().unwrap_or("").to_string(),
                        source_text: f["sourceText"].as_str().unwrap_or("").to_string(),
                        error: f["error"].as_str().unwrap_or("").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    })
}
