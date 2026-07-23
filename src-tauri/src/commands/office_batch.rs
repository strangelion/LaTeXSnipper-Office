//! Office batch conversion commands.
//!
//! Commands:
//! - `office_batch_scan_latex` — Scan the active Office document for LaTeX candidates.
//! - `office_batch_convert_plan` — Build a conversion plan from candidates.
//! - `office_batch_execute` — Send the plan to the Native Office host for execution.

use tauri::State;
use std::sync::Arc;

use crate::office_integration::batch_conversion;
use crate::office_integration::dto::*;

/// Scan the active Office document for LaTeX candidates.
///
/// Sends a scan request to the VSTO host and returns detected candidates.
#[tauri::command]
pub async fn office_batch_scan_latex(
    _session_id: String,
    _scope: String,
) -> Result<Vec<LatexCandidate>, String> {
    // For now, return an empty result — the actual candidates will
    // be emitted via events and collected by the frontend.
    // The VSTO integration will emit `native-office-scan-result` events.
    log::info!("[BatchConversion] Scan requested (session={_session_id}, scope={_scope})");
    Ok(Vec::new())
}

/// Build a batch conversion plan from LaTeX candidates.
#[tauri::command]
pub async fn office_batch_convert_plan(
    candidates: Vec<LatexCandidate>,
) -> Result<BatchConversionPlan, String> {
    batch_conversion::build_conversion_plan(candidates)
}

/// Execute a batch conversion plan on the Native Office host.
#[tauri::command]
pub async fn office_batch_execute(
    #[cfg(target_os = "windows")] _session_mgr: State<'_, Arc<crate::platforms::session::SessionManager>>,
    _session_id: String,
    _plan: BatchConversionPlan,
) -> Result<BatchConversionResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Batch execution is only available on Windows.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let result = batch_conversion::compute_batch_result(&_plan);

        if result.converted == 0 && result.total > 0 {
            return Err(format!(
                "No items could be converted. {} total, {} failed.",
                result.total, result.failed
            ));
        }

        log::info!(
            "[BatchConversion] Plan {}: {}/{} converted, {} failed",
            _plan.id, result.converted, result.total, result.failed
        );

        Ok(result)
    }
}
