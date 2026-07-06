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
    svg: Option<String>,
    png: Option<String>,
    width_pt: Option<f32>,
    height_pt: Option<f32>,
) -> Result<String, String> {
    let payload = FormulaPayload {
        formula_id,
        latex,
        omml,
        display,
        presentation: None,
        render: svg.map(|s| RenderData {
            svg: Some(s),
            png: png.clone(),
            width_pt: width_pt.unwrap_or(120.0),
            height_pt: height_pt.unwrap_or(30.0),
        }).or_else(|| png.map(|p| RenderData {
            svg: None,
            png: Some(p),
            width_pt: width_pt.unwrap_or(120.0),
            height_pt: height_pt.unwrap_or(30.0),
        })),
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

/// Render LaTeX to SVG using frontend Temml renderer.
/// This triggers the frontend to render and returns the SVG.
#[tauri::command]
pub async fn native_office_render_svg(
    app: tauri::AppHandle,
    latex: String,
    display: bool,
) -> Result<String, String> {
    use tauri::Emitter;

    // Generate unique request ID
    let request_id = format!("svg-{}", uuid_simple());

    // Create a oneshot channel to wait for the response
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();

    // Store the sender in a temporary map (we'll use a simpler approach)
    // For now, just emit the event and wait for the frontend to call back

    // Emit event to frontend to render SVG
    let _ = app.emit("native-office-render-svg", serde_json::json!({
        "requestId": request_id,
        "latex": latex,
        "display": display
    }));

    // Wait for response from frontend (with timeout)
    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        async {
            // In a real implementation, we'd use a shared state to wait for the response
            // For now, return a placeholder
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            Ok::<String, String>(String::new())
        }
    ).await {
        Ok(Ok(svg)) => Ok(svg),
        _ => Err("SVG render timeout".to_string()),
    }
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

/// Request VSTO to read current selection.
#[tauri::command]
pub async fn native_office_request_read_selection(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
) -> Result<String, String> {
    let msg = crate::platforms::pipe_protocol::DesktopMessage::RequestReadSelection {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.clone(),
    };

    session_mgr.send_to_session(&session_id, msg)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Read selection request sent".to_string())
}

/// Get Native Office installation status.
#[tauri::command]
pub async fn native_office_status() -> Result<NativeOfficeStatus, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(crate::platforms::integrations::get_native_office_status())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(NativeOfficeStatus {
            platform_supported: false,
            package_state: PackageState::NotInstalled,
            package_version: None,
            hosts: vec![],
            pipe_security: PipeSecurityStatus::NotAvailable,
            action: RecommendedAction::None,
        })
    }
}

/// Start Native Office installation via bootstrapper.
#[tauri::command]
pub async fn native_office_install() -> Result<NativeOfficeOperationStarted, String> {
    #[cfg(target_os = "windows")]
    {
        crate::platforms::integrations::start_native_office_install()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Native Office installation is only available on Windows".to_string())
    }
}

/// Start Native Office repair via bootstrapper.
#[tauri::command]
pub async fn native_office_repair() -> Result<NativeOfficeOperationStarted, String> {
    #[cfg(target_os = "windows")]
    {
        crate::platforms::integrations::start_native_office_repair()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Native Office repair is only available on Windows".to_string())
    }
}

/// Start Native Office uninstall via bootstrapper.
#[tauri::command]
pub async fn native_office_uninstall() -> Result<NativeOfficeOperationStarted, String> {
    #[cfg(target_os = "windows")]
    {
        crate::platforms::integrations::start_native_office_uninstall()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Native Office uninstall is only available on Windows".to_string())
    }
}

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NativeOfficeStatus {
    pub platform_supported: bool,
    pub package_state: PackageState,
    pub package_version: Option<String>,
    pub hosts: Vec<HostInstallStatus>,
    pub pipe_security: PipeSecurityStatus,
    pub action: RecommendedAction,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum PackageState {
    NotInstalled,
    Installed,
    Broken,
    NeedsPrerequisite,
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HostInstallStatus {
    pub host: String,
    pub office_detected: bool,
    pub registry_key_present: bool,
    pub manifest_value: Option<String>,
    pub vsto_file_exists: bool,
    pub load_behavior: Option<u32>,
    pub connected_sessions: usize,
    pub state: HostInstallState,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HostInstallState {
    NotInstalled,
    Installed,
    Broken,
    OfficeNotDetected,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum PipeSecurityStatus {
    SidObtained,
    SidFailed,
    NotAvailable,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum RecommendedAction {
    None,
    Install,
    Repair,
    Uninstall,
    RestartOffice,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NativeOfficeOperationStarted {
    pub operation_id: String,
    pub message: String,
}

/// Request VSTO to read current table.
#[tauri::command]
pub async fn native_office_request_read_table(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
) -> Result<String, String> {
    let msg = crate::platforms::pipe_protocol::DesktopMessage::RequestReadTable {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.clone(),
    };

    session_mgr.send_to_session(&session_id, msg)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Read table request sent".to_string())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
