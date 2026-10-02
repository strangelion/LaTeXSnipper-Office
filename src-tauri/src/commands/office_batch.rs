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
use tauri::{Emitter, State};

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
    app: tauri::AppHandle,
    session_mgr: State<'_, Arc<SessionManager>>,
    waiter: State<'_, Arc<RequestWaiter>>,
    mut plan: BatchConversionPlan,
) -> Result<BatchConversionResult, String> {
    let target = plan
        .target
        .clone()
        .ok_or("Plan has no target — was it built by office_batch_convert_plan?")?;

    let plan_id = plan.id.clone();
    let total = plan.items.len();

    // Office COM hosts run document mutations on their STA thread. Sending a
    // 10k-item plan as one request makes the desktop waiter time out while the
    // host is still mutating the document. Execute bounded chunks instead so
    // completed chunks are durable and later failures are isolated.
    // Real Word acceptance reached 114.5s for 100 simple equations, close to
    // the 120s transport deadline. Keep smaller batches for headroom; a single
    // pathological formula can still time out and requires reconciliation.
    const CHUNK_SIZE: usize = 25;
    plan.items.sort_by(|left, right| {
        let left_scope = locator_scope(left);
        let right_scope = locator_scope(right);
        left_scope
            .cmp(&right_scope)
            .then_with(|| locator_start(right).cmp(&locator_start(left)))
    });

    let mut aggregate = BatchConversionResult {
        total,
        converted: 0,
        skipped: 0,
        failed: 0,
        failures: Vec::new(),
    };
    let chunk_count = total.div_ceil(CHUNK_SIZE);
    let _ = app.emit(
        "office-batch-progress",
        serde_json::json!({
            "planId": plan_id.clone(),
            "processed": 0,
            "total": total,
            "chunk": 0,
            "chunkCount": chunk_count,
        }),
    );

    for (chunk_index, items) in plan.items.chunks(CHUNK_SIZE).enumerate() {
        let request_id = format!("batch-{}", uuid_simple());
        let chunk_id = format!("{}-part-{}", plan_id, chunk_index + 1);
        let chunk_plan = BatchConversionPlan {
            id: chunk_id.clone(),
            target: Some(target.clone()),
            items: items.to_vec(),
        };
        let msg = DesktopMessage::BatchConvert {
            requestId: request_id.clone(),
            sessionId: target.session_id.clone(),
            expectedContextId: target.document_context.clone(),
            planId: chunk_id,
            plan: serde_json::to_value(&chunk_plan)
                .map_err(|e| format!("Serialization failed: {e}"))?,
        };

        let result = match send_and_wait(
            &waiter,
            &session_mgr,
            request_id,
            &target.session_id,
            msg,
            120,
        )
        .await
        {
            Ok(result) => result,
            Err(error) => {
                let remaining = &plan.items[chunk_index * CHUNK_SIZE..];
                aggregate.failed += remaining.len();
                aggregate
                    .failures
                    .extend(remaining.iter().map(|item| BatchFailure {
                        source_id: item.source_id.clone(),
                        source_text: item.source_text.clone(),
                        error: format!(
                            "Batch stopped after {} completed item(s): {error}",
                            aggregate.converted + aggregate.skipped
                        ),
                    }));
                break;
            }
        };

        if !result.success {
            let error = result
                .error
                .unwrap_or_else(|| "Batch command failed".to_string());
            let remaining = &plan.items[chunk_index * CHUNK_SIZE..];
            aggregate.failed += remaining.len();
            aggregate
                .failures
                .extend(remaining.iter().map(|item| BatchFailure {
                    source_id: item.source_id.clone(),
                    source_text: item.source_text.clone(),
                    error: error.clone(),
                }));
            break;
        }

        let Some(value) = result.data else {
            let remaining = &plan.items[chunk_index * CHUNK_SIZE..];
            aggregate.failed += remaining.len();
            aggregate
                .failures
                .extend(remaining.iter().map(|item| BatchFailure {
                    source_id: item.source_id.clone(),
                    source_text: item.source_text.clone(),
                    error: "Office host returned no batch result data".to_string(),
                }));
            break;
        };
        aggregate.converted += value["converted"].as_u64().unwrap_or(0) as usize;
        aggregate.skipped += value["skipped"].as_u64().unwrap_or(0) as usize;
        aggregate.failed += value["failed"].as_u64().unwrap_or(0) as usize;
        aggregate
            .failures
            .extend(
                value["failures"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|failure| BatchFailure {
                        source_id: failure["sourceId"].as_str().unwrap_or("").to_string(),
                        source_text: failure["sourceText"].as_str().unwrap_or("").to_string(),
                        error: failure["error"].as_str().unwrap_or("").to_string(),
                    }),
            );
        let processed = ((chunk_index + 1) * CHUNK_SIZE).min(total);
        let _ = app.emit(
            "office-batch-progress",
            serde_json::json!({
                "planId": plan_id.clone(),
                "processed": processed,
                "total": total,
                "converted": aggregate.converted,
                "skipped": aggregate.skipped,
                "failed": aggregate.failed,
                "chunk": chunk_index + 1,
                "chunkCount": chunk_count,
            }),
        );
    }

    let processed = aggregate.converted + aggregate.skipped + aggregate.failed;
    let _ = app.emit(
        "office-batch-progress",
        serde_json::json!({
            "planId": plan_id,
            "processed": processed.min(total),
            "total": total,
            "converted": aggregate.converted,
            "skipped": aggregate.skipped,
            "failed": aggregate.failed,
            "chunk": processed.div_ceil(CHUNK_SIZE),
            "chunkCount": chunk_count,
            "complete": true,
        }),
    );

    Ok(aggregate)
}

#[cfg(target_os = "windows")]
fn locator_start(item: &BatchConversionItem) -> i64 {
    item.locator
        .as_ref()
        .and_then(|locator| locator.get("start"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(i64::MIN)
}

#[cfg(target_os = "windows")]
fn locator_scope(item: &BatchConversionItem) -> String {
    let Some(locator) = item.locator.as_ref() else {
        return String::new();
    };
    [
        "storyType",
        "sectionIndex",
        "worksheet",
        "address",
        "slideId",
        "shapeId",
    ]
    .iter()
    .filter_map(|key| locator.get(*key).map(|value| value.to_string()))
    .collect::<Vec<_>>()
    .join(":")
}
