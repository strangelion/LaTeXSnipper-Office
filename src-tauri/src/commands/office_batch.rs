//! Office batch conversion commands.
//!
//! These commands implement the real Desktop↔VSTO request-response flow:
//!   SCAN_LATEX → await SCAN_LATEX_RESULT
//!   BATCH_CONVERT → await BATCH_CONVERT_RESULT

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

/// Scan the active Office document for LaTeX candidates.
///
/// Sends SCAN_LATEX to VSTO, waits for SCAN_LATEX_RESULT via RequestWaiter.
#[tauri::command]
pub async fn office_batch_scan_latex(
    #[cfg(target_os = "windows")] session_mgr: State<'_, Arc<SessionManager>>,
    #[cfg(target_os = "windows")] waiter: State<'_, Arc<RequestWaiter>>,
    session_id: String,
    scope: String,
) -> Result<Vec<LatexCandidate>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (session_id, scope);
        Err("Batch scan is only available on Windows.".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let request_id = format!("scan-{}", uuid_simple());
        let rx = waiter.register(request_id.clone()).await;

        let msg = DesktopMessage::ScanLatex {
            requestId: request_id.clone(),
            sessionId: session_id.clone(),
            expectedContextId: None,
            scope: scope.clone(),
        };

        session_mgr
            .send_to_session(&session_id, msg)
            .await
            .map_err(|e| format!("Failed to send scan request: {e}"))?;

        let result = tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "Scan timed out".to_string())?
            .map_err(|_| "Scan waiter dropped".to_string())?;

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
}

/// Build a batch conversion plan from LaTeX candidates.
#[tauri::command]
pub async fn office_batch_convert_plan(
    candidates: Vec<LatexCandidate>,
) -> Result<BatchConversionPlan, String> {
    batch_conversion::build_conversion_plan(candidates)
}

/// Execute a batch conversion plan via the Native Office pipe.
///
/// Sends BATCH_CONVERT to VSTO, waits for BATCH_CONVERT_RESULT.
#[tauri::command]
pub async fn office_batch_execute(
    #[cfg(target_os = "windows")] session_mgr: State<'_, Arc<SessionManager>>,
    #[cfg(target_os = "windows")] waiter: State<'_, Arc<RequestWaiter>>,
    session_id: String,
    plan: BatchConversionPlan,
) -> Result<BatchConversionResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (session_id, plan);
        Err("Batch execution is only available on Windows.".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let plan_id = plan.id.clone();
        let total = plan.items.len();
        let request_id = format!("batch-{}", uuid_simple());
        let rx = waiter.register(request_id.clone()).await;

        let msg = DesktopMessage::BatchConvert {
            requestId: request_id.clone(),
            sessionId: session_id.clone(),
            expectedContextId: String::new(),
            planId: plan_id.clone(),
            plan: serde_json::to_value(&plan).map_err(|e| format!("Serialization failed: {e}"))?,
        };

        session_mgr
            .send_to_session(&session_id, msg)
            .await
            .map_err(|e| format!("Failed to send batch request: {e}"))?;

        let result = tokio::time::timeout(Duration::from_secs(120), rx)
            .await
            .map_err(|_| "Batch execution timed out".to_string())?
            .map_err(|_| "Batch waiter dropped".to_string())?;

        if !result.success {
            return Err(result
                .error
                .unwrap_or_else(|| "Batch execution failed".to_string()));
        }

        // Parse the batch result
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
}

#[allow(dead_code)]
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
