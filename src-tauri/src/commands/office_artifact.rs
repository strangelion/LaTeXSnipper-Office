//! Office artifact insertion commands.
//!
//! These commands insert recognition results (formulas, tables, documents)
//! into the active Office host via the unified insertion pipeline.

#[cfg(target_os = "windows")]
use crate::platforms::session::SessionManager;
#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use tauri::State;

#[cfg(target_os = "windows")]
use crate::office_integration::dto::*;

/// Insert a recognition artifact into Office.
///
/// The artifact is produced by a recognition job and can be:
/// - A single formula
/// - A single table
/// - A full document (multi-block)
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn office_insert_artifact(
    #[cfg(target_os = "windows")] session_mgr: State<'_, Arc<SessionManager>>,
    artifact: Artifact,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = artifact;
        Err("Office insertion is only available on Windows.".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let session_id = &artifact.target.session_id;

        match artifact.artifact_type {
            ArtifactType::Formula => {
                // Extract formula payload from the artifact
                let latex = artifact
                    .payload
                    .get("latex")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let omml = artifact
                    .payload
                    .get("omml")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let display = artifact.options.display.as_deref().unwrap_or("inline");
                let storage_mode = artifact.options.storage_mode.as_deref().unwrap_or("auto");

                let formula_id = format!("rec-{}", uuid_simple());

                let payload = crate::platforms::pipe_protocol::FormulaPayload {
                    schema_version: Some(3),
                    formula_id: formula_id.clone(),
                    latex: latex.to_string(),
                    omml: omml.to_string(),
                    display: display.to_string(),
                    presentation: None,
                    render: None,
                    source: None,
                    storage_mode: Some(storage_mode.to_string()),
                    revision: 0,
                    created_utc_ticks: 0,
                    host: Some(artifact.target.host.to_string()),
                    document_context: Some(artifact.target.document_context.clone()),
                    object_context: None, // Filled by host after insertion
                    protocol_version: Some(
                        crate::platforms::pipe_protocol::PROTOCOL_VERSION as i32,
                    ),
                    requested_route: None,
                    actual_route: None,
                };

                let mode = match display {
                    "display" => crate::platforms::pipe_protocol::InsertMode::Display,
                    "numbered" | "displayNumbered" => {
                        crate::platforms::pipe_protocol::InsertMode::DisplayNumbered
                    }
                    _ => crate::platforms::pipe_protocol::InsertMode::Inline,
                };

                let im = storage_mode
                    .parse::<crate::platforms::pipe_protocol::FormulaIntegrationMode>()
                    .ok();

                crate::platforms::pipe_server::send_insert_formula(
                    &session_mgr,
                    session_id,
                    payload,
                    mode,
                    im,
                )
                .await
                .map_err(|e| e.to_string())?;

                Ok(format!("Formula {formula_id} inserted"))
            }

            ArtifactType::Table => {
                let table: crate::platforms::pipe_protocol::TablePayload =
                    serde_json::from_value(artifact.payload.clone())
                        .map_err(|e| format!("Invalid table payload: {e}"))?;

                crate::platforms::pipe_server::send_insert_table(&session_mgr, session_id, table)
                    .await
                    .map_err(|e| e.to_string())?;

                Ok("Table inserted".to_string())
            }

            ArtifactType::Document => {
                // Document insertion uses the conversation import pipeline.
                // For now, return an error that this is not yet implemented.
                Err("Full document insertion is not yet implemented. \
                     Use per-block insertion instead."
                    .to_string())
            }
        }
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
