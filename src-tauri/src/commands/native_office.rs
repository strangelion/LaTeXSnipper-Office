//! Tauri commands for Native Office VSTO integration.
//!
//! These commands replace the old Office.js Bridge commands and use
//! the Named Pipe communication with VSTO Add-ins.

use std::sync::Arc;
use tauri::State;

use crate::platforms::pipe_protocol::*;
use crate::platforms::session::{SessionManager, SessionInfo};

/// Get list of connected VSTO sessions.
#[tauri::command]
pub async fn native_office_sessions(
    session_mgr: State<'_, Arc<SessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    Ok(session_mgr.list_sessions().await)
}

/// Insert formula into the current Office host.
#[tauri::command]
pub async fn native_office_insert_formula(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    latex: String,
    omml: String,
    display: String,
    mode: String,
) -> Result<String, String> {
    let payload = FormulaPayload {
        formula_id,
        latex,
        omml,
        display,
        presentation: None,
        render: None,
        source: None,
    };

    let insert_mode = match mode.as_str() {
        "inline" => InsertMode::Inline,
        "display" => InsertMode::Display,
        "displayNumbered" => InsertMode::DisplayNumbered,
        _ => InsertMode::Display,
    };

    crate::platforms::pipe_server::send_insert_formula(&session_mgr, &session_id, payload, insert_mode)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Formula insertion sent".to_string())
}

/// Replace formula in the current Office host.
#[tauri::command]
pub async fn native_office_replace_formula(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    latex: String,
    omml: String,
    display: String,
) -> Result<String, String> {
    let payload = FormulaPayload {
        formula_id: formula_id.clone(),
        latex,
        omml,
        display,
        presentation: None,
        render: None,
        source: None,
    };

    crate::platforms::pipe_server::send_replace_formula(&session_mgr, &session_id, formula_id, payload)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Formula replacement sent".to_string())
}

/// Insert table into the current Office host.
#[tauri::command]
pub async fn native_office_insert_table(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    table_json: String,
) -> Result<String, String> {
    let table: TablePayload = serde_json::from_str(&table_json)
        .map_err(|e| format!("Invalid table JSON: {}", e))?;

    crate::platforms::pipe_server::send_insert_table(&session_mgr, &session_id, table)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Table insertion sent".to_string())
}

/// Delete current selection in the Office host.
#[tauri::command]
pub async fn native_office_delete_current(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: Option<String>,
) -> Result<String, String> {
    crate::platforms::pipe_server::send_delete_current(&session_mgr, &session_id, formula_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Delete sent".to_string())
}

/// Format selection in the Office host.
#[tauri::command]
pub async fn native_office_format_selection(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    font_family: Option<String>,
    font_size: Option<f32>,
    font_color: Option<String>,
) -> Result<String, String> {
    let options = FormatOptions {
        font_family,
        font_size,
        font_color,
    };

    crate::platforms::pipe_server::send_format_selection(&session_mgr, &session_id, options)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Format sent".to_string())
}

/// Format all formulas in the Office host.
#[tauri::command]
pub async fn native_office_format_all(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    font_family: Option<String>,
    font_size: Option<f32>,
    font_color: Option<String>,
) -> Result<String, String> {
    let options = FormatOptions {
        font_family,
        font_size,
        font_color,
    };

    crate::platforms::pipe_server::send_format_all(&session_mgr, &session_id, options)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Format all sent".to_string())
}

/// Renumber Word formulas.
#[tauri::command]
pub async fn native_office_renumber_word(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    start_from: Option<u32>,
) -> Result<String, String> {
    crate::platforms::pipe_server::send_renumber_word(&session_mgr, &session_id, start_from)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Renumber sent".to_string())
}

/// Insert Word cross-reference.
#[tauri::command]
pub async fn native_office_insert_reference(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    reference_type: String,
) -> Result<String, String> {
    crate::platforms::pipe_server::send_insert_word_reference(&session_mgr, &session_id, formula_id, reference_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Reference insertion sent".to_string())
}
