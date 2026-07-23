//! Office artifact insertion commands.
//!
//! These commands insert recognition results (formulas, tables, documents)
//! into the active Office host via the unified insertion pipeline.

use crate::office_integration::dto::OfficeHost;
use crate::office_integration::{OfficeCoordinator, ResolvedRoute};

/// Resolve the integration route for a given Office host.
/// Auto → NativeOffice if VSTO session available, else error.
#[tauri::command]
pub async fn office_resolve_route(
    coordinator: tauri::State<'_, OfficeCoordinator>,
    host: String,
    preferred_session_id: Option<String>,
    expected_document_id: Option<String>,
) -> Result<ResolvedRoute, String> {
    let host = OfficeHost::parse(&host).ok_or_else(|| format!("Unknown host: {host}"))?;
    coordinator
        .resolve_route(
            host,
            preferred_session_id.as_deref(),
            expected_document_id.as_deref(),
        )
        .await
}

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
                    requested_route: Some("auto".to_string()),
                    actual_route: Some("nativeOffice".to_string()),
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

                let ctx = Some(artifact.target.document_context.clone());
                crate::platforms::pipe_server::send_insert_formula(
                    &session_mgr,
                    session_id,
                    ctx,
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

                crate::platforms::pipe_server::send_insert_table(
                    &session_mgr,
                    session_id,
                    None,
                    table,
                )
                .await
                .map_err(|e| e.to_string())?;

                Ok("Table inserted".to_string())
            }

            ArtifactType::Document => {
                use crate::platforms::conversation_import::WordImportPlan;
                use crate::platforms::pipe_protocol::DesktopMessage;

                if artifact.target.host != OfficeHost::Word {
                    return Err(
                        "Structured document insertion currently supports Word only.".to_string(),
                    );
                }

                let plan: WordImportPlan = serde_json::from_value(artifact.payload.clone())
                    .map_err(|e| format!("Invalid Word document import plan: {e}"))?;

                if !plan.can_commit {
                    return Err("Word document import plan contains conversion errors.".to_string());
                }
                if plan.operations.is_empty() {
                    return Err("Word document import plan contains no operations.".to_string());
                }

                let session = session_mgr
                    .list_sessions()
                    .await
                    .into_iter()
                    .find(|s| s.session_id == artifact.target.session_id)
                    .ok_or_else(|| "Target Office session is no longer connected.".to_string())?;

                if session.host_type != crate::platforms::session::HostType::Word {
                    return Err(
                        "Structured document insertion requires a Word session.".to_string()
                    );
                }
                if session.document_id.as_deref() != Some(artifact.target.document_context.as_str())
                {
                    return Err(
                        "DESTINATION_CHANGED: Word document context changed before insertion."
                            .to_string(),
                    );
                }

                let request_id = format!("doc-{}", uuid_simple());
                let message = DesktopMessage::ImportConversation {
                    requestId: request_id,
                    sessionId: artifact.target.session_id.clone(),
                    expectedContextId: artifact.target.document_context.clone(),
                    plan,
                };

                session_mgr
                    .send_to_session(&artifact.target.session_id, message)
                    .await
                    .map_err(|e| e.to_string())?;

                Ok("Structured document insertion requested".to_string())
            }
        }
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
