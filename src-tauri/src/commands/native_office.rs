//! Tauri commands for Native Office VSTO integration.
//!
//! These commands replace the old Office.js Bridge commands and use
//! the Named Pipe communication with VSTO Add-ins.

use std::sync::Arc;
use tauri::State;

use crate::platforms::pipe_protocol::*;
use crate::platforms::session::{SessionInfo, SessionManager};

/// Get list of connected VSTO sessions.
#[tauri::command]
pub async fn native_office_sessions(
    session_mgr: State<'_, Arc<SessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    Ok(session_mgr.list_sessions().await)
}

/// Insert formula into the current Office host.
#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri command parameters are part of the public invoke ABI"
)]
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
    integration_mode: Option<String>,
) -> Result<String, String> {
    let payload = FormulaPayload {
        schema_version: Some(3),
        formula_id,
        latex,
        omml,
        display,
        presentation: None,
        render: svg
            .map(|s| RenderData {
                svg: Some(s),
                png: png.clone(),
                width_pt: width_pt.unwrap_or(120.0),
                height_pt: height_pt.unwrap_or(30.0),
            })
            .or_else(|| {
                png.map(|p| RenderData {
                    svg: None,
                    png: Some(p),
                    width_pt: width_pt.unwrap_or(120.0),
                    height_pt: height_pt.unwrap_or(30.0),
                })
            }),
        source: None,
        storage_mode: integration_mode.as_deref().map(|s| match s {
            "ole" => "ole".to_string(),
            "image" => "image".to_string(),
            "native" => "native-omml".to_string(),
            _ => "auto".to_string(),
        }),
        revision: 0,
        created_utc_ticks: 0,
    };

    let insert_mode = match mode.as_str() {
        "inline" => InsertMode::Inline,
        "display" => InsertMode::Display,
        "numbered" | "displayNumbered" => InsertMode::DisplayNumbered,
        _ => InsertMode::Display,
    };

    // Resolve integration mode. OLE is supported by the native handler: the
    // frontend sends render.png and the COM object converts it to an EMF preview.
    let im = integration_mode.as_deref().map(|s| match s {
        "ole" => FormulaIntegrationMode::Ole,
        "native" => FormulaIntegrationMode::Native,
        "image" => FormulaIntegrationMode::Image,
        _ => FormulaIntegrationMode::Auto,
    });

    crate::platforms::pipe_server::send_insert_formula(
        &session_mgr,
        &session_id,
        payload,
        insert_mode,
        im,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok("Formula insertion sent".to_string())
}

/// Replace formula in the current Office host.
#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri command parameters are part of the public invoke ABI"
)]
pub async fn native_office_replace_formula(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    latex: String,
    omml: String,
    display: String,
    svg: Option<String>,
    png: Option<String>,
    width_pt: Option<f32>,
    height_pt: Option<f32>,
    storage_mode: Option<String>,
    expected_revision: Option<u64>,
) -> Result<String, String> {
    let revision = expected_revision
        .map(i32::try_from)
        .transpose()
        .map_err(|_| "Expected formula revision exceeds the protocol limit".to_string())?
        .unwrap_or(0);
    let payload = FormulaPayload {
        schema_version: Some(3),
        formula_id: formula_id.clone(),
        latex,
        omml,
        display,
        presentation: None,
        render: svg
            .map(|s| RenderData {
                svg: Some(s),
                png: png.clone(),
                width_pt: width_pt.unwrap_or(120.0),
                height_pt: height_pt.unwrap_or(30.0),
            })
            .or_else(|| {
                png.map(|p| RenderData {
                    svg: None,
                    png: Some(p),
                    width_pt: width_pt.unwrap_or(120.0),
                    height_pt: height_pt.unwrap_or(30.0),
                })
            }),
        source: None,
        storage_mode,
        revision,
        created_utc_ticks: 0,
    };

    crate::platforms::pipe_server::send_replace_formula(
        &session_mgr,
        &session_id,
        formula_id,
        payload,
    )
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
    let table: TablePayload =
        serde_json::from_str(&table_json).map_err(|e| format!("Invalid table JSON: {}", e))?;

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
    crate::platforms::pipe_server::send_insert_word_reference(
        &session_mgr,
        &session_id,
        formula_id,
        reference_type,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok("Reference insertion sent".to_string())
}

/// Convert a formula between storage modes (image ↔ ole, native ↔ ole).
#[tauri::command]
#[allow(
    dead_code,
    reason = "Reserved for VSTO protocol clients during staged rollout"
)]
pub async fn native_office_convert_formula(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    target_mode: String,
) -> Result<String, String> {
    let msg = crate::platforms::pipe_protocol::DesktopMessage::ConvertFormula {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.clone(),
        expectedContextId: None,
        formulaId: formula_id,
        targetMode: target_mode,
    };

    session_mgr
        .send_to_session(&session_id, msg)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Conversion request sent".to_string())
}

/// Check OLE component availability.
#[tauri::command]
pub async fn native_office_ole_status() -> Result<OleStatus, String> {
    Ok(crate::platforms::integrations::check_ole_status())
}

/// Check VSTO trust status: runtime, certificate, manifest loading.
#[tauri::command]
pub async fn native_office_vsto_trust_status(
) -> Result<crate::platforms::integrations::VstoTrustStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let runtime = crate::platforms::integrations::detect_vsto_runtime();
        let cert_trusted = crate::platforms::integrations::check_certificate_trusted();

        let overall_status = if runtime && cert_trusted {
            "ready".to_string()
        } else if runtime && !cert_trusted {
            "needs_certificate_trust".to_string()
        } else if !runtime && cert_trusted {
            "needs_vsto_runtime".to_string()
        } else {
            "needs_setup".to_string()
        };

        Ok(crate::platforms::integrations::VstoTrustStatus {
            runtime_installed: runtime,
            certificate_trusted: cert_trusted,
            manifest_loaded: false,
            pipe_session_connected: false,
            overall_status,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(crate::platforms::integrations::VstoTrustStatus {
            runtime_installed: false,
            certificate_trusted: false,
            manifest_loaded: false,
            pipe_session_connected: false,
            overall_status: "not_supported".to_string(),
        })
    }
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

    session_mgr
        .send_to_session(&session_id, msg)
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
            vsto_runtime_installed: false,
            certificate_trusted: false,
            ole: OleStatus {
                available: false,
                bitness_mismatch: false,
                x64_registered: false,
                x86_registered: false,
                x64_dll_exists: false,
                x86_dll_exists: false,
                health: "NotSupported".to_string(),
                detail: "Office integration is only available on Windows.".to_string(),
                error_code: Some("OLE_NOT_SUPPORTED".to_string()),
                ..Default::default()
            },
        })
    }
}

/// Start Native Office installation via bootstrapper.
#[tauri::command]
pub async fn native_office_install() -> Result<NativeOfficeOperationStarted, String> {
    #[cfg(target_os = "windows")]
    {
        crate::platforms::integrations::start_native_office_install().map_err(|e| e.to_string())
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
        crate::platforms::integrations::start_native_office_repair().map_err(|e| e.to_string())
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
        crate::platforms::integrations::start_native_office_uninstall().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Native Office uninstall is only available on Windows".to_string())
    }
}

/// Install OLE COM component (x86/x64 dual registry view).
#[tauri::command]
pub async fn native_office_install_ole(
) -> Result<crate::platforms::integrations::OleComponentResult, String> {
    #[cfg(target_os = "windows")]
    {
        let result = crate::platforms::integrations::install_ole_component();
        if result.success {
            Ok(result)
        } else {
            Err(result.message)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("OLE installation is only available on Windows".to_string())
    }
}

/// Re-register VSTO add-ins and re-import signing certificate.
#[tauri::command]
pub async fn native_office_repair_vsto(
) -> Result<crate::platforms::integrations::PlatformIntegrationResult, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(crate::platforms::integrations::install_native_office_vsto())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("VSTO repair is only available on Windows".to_string())
    }
}

/// Uninstall OLE COM component (remove dual registry view).
#[tauri::command]
pub async fn native_office_uninstall_ole(
) -> Result<crate::platforms::integrations::OleComponentResult, String> {
    #[cfg(target_os = "windows")]
    {
        let result = crate::platforms::integrations::uninstall_ole_component();
        if result.success {
            Ok(result)
        } else {
            Err(result.message)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("OLE uninstall is only available on Windows".to_string())
    }
}

/// Validate OLE component: runs smoke checks and returns detailed status.
#[tauri::command]
pub async fn native_office_validate_ole(
) -> Result<crate::platforms::integrations::OleStatus, String> {
    Ok(crate::platforms::integrations::check_ole_status())
}

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOfficeStatus {
    pub platform_supported: bool,
    pub package_state: PackageState,
    pub package_version: Option<String>,
    pub hosts: Vec<HostInstallStatus>,
    pub pipe_security: PipeSecurityStatus,
    pub action: RecommendedAction,
    /// Whether VSTO Runtime is installed on the system
    pub vsto_runtime_installed: bool,
    /// Whether the VSTO signing certificate is trusted (in TrustedPublisher store)
    pub certificate_trusted: bool,
    /// OLE COM component status
    pub ole: OleStatus,
}

pub use crate::platforms::integrations::OleStatus;

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
#[serde(rename_all = "camelCase")]
pub struct RegistryEntryStatus {
    pub present: bool,
    pub load_behavior: Option<u32>,
    pub manifest: Option<String>,
    pub valid: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInstallStatus {
    pub host: String,
    pub office_detected: bool,
    /// Per-view (x64/x86) registry status for dual-bit Office support.
    pub registry_x64: RegistryEntryStatus,
    pub registry_x86: RegistryEntryStatus,
    pub manifest_exists: bool,
    pub connected_sessions: usize,
    pub state: HostInstallState,
    pub capabilities: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
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

    session_mgr
        .send_to_session(&session_id, msg)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Read table request sent".to_string())
}

/// Commit a previously previewed browser conversation through the Native Word adapter.
#[tauri::command]
pub async fn native_office_import_conversation(
    session_mgr: State<'_, Arc<SessionManager>>,
    store: State<'_, Arc<crate::platforms::conversation_import::ConversationImportStore>>,
    action_id: String,
) -> Result<String, String> {
    let record = store
        .get(&action_id)
        .await
        .ok_or("Browser import not found")?;
    let session_id = record
        .destination_session_id
        .clone()
        .ok_or("A Native Word destination must be selected")?;
    let expected_document_id = record
        .expected_document_id
        .clone()
        .ok_or("Destination document identity is missing")?;
    let session = session_mgr
        .list_sessions()
        .await
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or("Destination session is no longer connected")?;
    if session.host_type != crate::platforms::session::HostType::Word {
        return Err("STRUCTURED_IMPORT_DESTINATION_UNSUPPORTED".into());
    }
    if session.document_id.as_deref() != Some(expected_document_id.as_str()) {
        return Err("DESTINATION_CHANGED".into());
    }
    let plan = crate::platforms::conversation_import::compile_word_plan(&record);
    if !plan.can_commit {
        return Err("WORD_IMPORT_PLAN_HAS_ERRORS".into());
    }
    store
        .set_status(
            &action_id,
            crate::platforms::conversation_import::BrowserImportStatus::Committing,
            None,
        )
        .await?;
    let message = DesktopMessage::ImportConversation {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.clone(),
        expectedContextId: expected_document_id,
        plan,
    };
    if let Err(error) = session_mgr.send_to_session(&session_id, message).await {
        let diagnostic = crate::platforms::conversation_import::ImportDiagnostic {
            code: "WORD_IMPORT_SEND_FAILED".into(),
            message: error.to_string(),
        };
        store
            .set_status(
                &action_id,
                crate::platforms::conversation_import::BrowserImportStatus::Failed,
                Some(diagnostic),
            )
            .await?;
        return Err(error.to_string());
    }
    Ok("Conversation import commit requested".into())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
