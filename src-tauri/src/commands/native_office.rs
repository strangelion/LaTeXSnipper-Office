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
            "vector" => "vector".to_string(),
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
        "vector" => FormulaIntegrationMode::Vector,
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
    expected_document_id: Option<String>,
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

    let request_id = crate::platforms::pipe_server::send_replace_formula(
        &session_mgr,
        &session_id,
        expected_document_id,
        formula_id,
        payload,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(request_id)
}

#[tauri::command]
pub async fn native_office_read_formula_by_id(
    session_mgr: State<'_, Arc<SessionManager>>,
    session_id: String,
    formula_id: String,
    expected_document_id: Option<String>,
) -> Result<String, String> {
    crate::platforms::pipe_server::send_read_formula(
        &session_mgr,
        &session_id,
        expected_document_id,
        formula_id,
    )
    .await
    .map_err(|error| error.to_string())
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

/// Test AI API connection by sending a minimal request.
#[tauri::command]
pub async fn native_office_ai_test_connection(
    endpoint: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Reply with just: OK"}],
        "max_tokens": 5,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client creation failed: {}", e))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Connection test failed: {}", e))?;

    if response.status().is_success() {
        Ok("Connection successful".to_string())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(format!("API error ({}): {}", status, text))
    }
}

/// AI → Office orchestrator: generate formula via AI and insert into Word.
///
/// Complete pipeline:
///   1. User prompt → AI API (OpenAI-compatible)
///   2. AI response → parse LaTeX
///   3. LaTeX → OMML via core
///   4. FormulaPayload{latex, omml} → INSERT_FORMULA to Word
///
/// This is the unified entry point for "AI generate and insert formula".
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn native_office_generate_and_insert(
    session_mgr: State<'_, Arc<SessionManager>>,
    waiter: State<'_, Arc<crate::platforms::office_commit::RequestWaiter>>,
    session_id: String,
    prompt: String,
    display: String,
    ai_endpoint: Option<String>,
    ai_api_key: Option<String>,
    ai_model: Option<String>,
    storage_mode: Option<String>,
) -> Result<GenerateInsertResult, String> {
    let endpoint = ai_endpoint.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let api_key = ai_api_key.ok_or("AI API key is required")?;
    let model = ai_model.unwrap_or_else(|| "gpt-4o".to_string());

    // Step 1: Call AI to generate LaTeX
    log::info!(
        "[AI→Office] Generating formula via AI (model={}, endpoint={})",
        model,
        endpoint
    );
    let latex = call_ai_for_formula(&endpoint, &api_key, &model, &prompt).await?;

    // Step 2: Convert LaTeX to OMML
    log::info!("[AI→Office] Converting LaTeX to OMML...");
    let latex_clone = latex.clone();
    let omml = tokio::task::spawn_blocking(move || {
        latexsnipper_conversion::DocumentConverter::convert_latex_string(
            &latex_clone,
            latexsnipper_conversion::OutputFormat::OMML,
        )
        .ok()
    })
    .await
    .map_err(|e| format!("OMML conversion task failed: {}", e))?
    .ok_or("LaTeX to OMML conversion failed")?;

    log::info!(
        "[AI→Office] OMML generated ({} bytes) from LaTeX: {}",
        omml.len(),
        &latex.chars().take(50).collect::<String>()
    );

    // Step 3: Build FormulaPayload and send to Word
    let formula_id = uuid_simple();
    let integration_mode = storage_mode.as_deref().unwrap_or("auto");
    let insert_mode = match display.as_str() {
        "numbered" | "displayNumbered" => InsertMode::DisplayNumbered,
        "display" | "block" => InsertMode::Display,
        _ => InsertMode::Inline,
    };

    let payload = FormulaPayload {
        schema_version: Some(3),
        formula_id: formula_id.clone(),
        latex: latex.clone(),
        omml: omml.clone(),
        display: display.clone(),
        presentation: None,
        render: None,
        source: None,
        storage_mode: storage_mode.clone(),
        revision: 0,
        created_utc_ticks: 0,
    };

    let im = integration_mode
        .parse::<FormulaIntegrationMode>()
        .ok()
        .unwrap_or(FormulaIntegrationMode::Auto);

    // Register waiter before sending (so we don't miss the result)
    let request_id = crate::platforms::pipe_server::send_insert_formula(
        &session_mgr,
        &session_id,
        payload,
        insert_mode,
        Some(im),
    )
    .await
    .map_err(|e| format!("Failed to send insert command: {}", e))?;

    // Wait for Word to confirm insertion (with 15s timeout)
    let rx = waiter.register(request_id.clone()).await;
    let result = match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(Ok(host_result)) => host_result,
        Ok(Err(_)) => {
            return Err("Insert result channel disconnected".to_string());
        }
        Err(_) => {
            return Err("Insert timed out waiting for Word response".to_string());
        }
    };

    if !result.success {
        return Err(format!(
            "Word insert failed: {}",
            result.error.unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    log::info!("[AI→Office] Formula confirmed inserted into Word");

    Ok(GenerateInsertResult {
        formula_id,
        latex,
        omml,
        display,
    })
}

/// Result of a generate-and-insert operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInsertResult {
    pub formula_id: String,
    pub latex: String,
    pub omml: String,
    pub display: String,
}

/// Call an OpenAI-compatible API to generate a LaTeX formula from a natural language prompt.
async fn call_ai_for_formula(
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let system_prompt = "You are a LaTeX formula generator. Given a natural language description, output ONLY the LaTeX math formula. No explanations, no markdown, no $$ delimiters. Just the raw LaTeX code. For example, for 'quadratic formula' output: \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}";

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 256,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client creation failed: {}", e))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("AI API error ({}): {}", status, text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("AI API response parse failed: {}", e))?;

    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("AI response missing content")?
        .trim()
        .to_string();

    // Clean up the response: remove markdown code blocks, $$ delimiters, etc.
    let latex = clean_ai_latex_response(&content);

    log::info!(
        "[AI→Office] AI response: {}",
        &latex.chars().take(80).collect::<String>()
    );
    Ok(latex)
}

/// Clean up AI-generated LaTeX response by removing common formatting artifacts.
fn clean_ai_latex_response(raw: &str) -> String {
    let mut s = raw.trim().to_string();

    // Remove ```latex ... ``` code blocks
    if s.starts_with("```latex") {
        s = s[8..].to_string();
    } else if s.starts_with("```") {
        s = s[3..].to_string();
    }
    if s.ends_with("```") {
        s = s[..s.len() - 3].to_string();
    }

    // Remove $$ delimiters
    s = s.trim().to_string();
    if s.starts_with("$$") && s.ends_with("$$") && s.len() > 4 {
        s = s[2..s.len() - 2].trim().to_string();
    } else if s.starts_with('$') && s.ends_with('$') && s.len() > 2 {
        s = s[1..s.len() - 1].trim().to_string();
    }

    // Remove any leading/trailing whitespace
    s.trim().to_string()
}

impl std::str::FromStr for FormulaIntegrationMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "ole" => Ok(FormulaIntegrationMode::Ole),
            "native" => Ok(FormulaIntegrationMode::Native),
            "image" => Ok(FormulaIntegrationMode::Image),
            "vector" => Ok(FormulaIntegrationMode::Vector),
            _ => Ok(FormulaIntegrationMode::Auto),
        }
    }
}

/// AI → Word full content orchestrator: generate structured content via AI
/// and insert as a complete conversation into Word.
///
/// Pipeline:
///   1. User prompt → AI API (structured JSON output)
///   2. AI response → parse into WordImportPlan operations
///   3. LaTeX formulas in operations → OMML conversion
///   4. WordImportPlan → IMPORT_CONVERSATION to Word
///
/// Supports: headings, paragraphs, inline/display formulas, tables, lists.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn native_office_generate_and_import(
    session_mgr: State<'_, Arc<SessionManager>>,
    waiter: State<'_, Arc<crate::platforms::office_commit::RequestWaiter>>,
    _conversation_store: State<
        '_,
        Arc<crate::platforms::conversation_import::ConversationImportStore>,
    >,
    session_id: String,
    prompt: String,
    ai_endpoint: Option<String>,
    ai_api_key: Option<String>,
    ai_model: Option<String>,
) -> Result<GenerateImportResult, String> {
    // Step 0: Validate target is Word (IMPORT_CONVERSATION only supports Word)
    let session = session_mgr
        .list_sessions()
        .await
        .into_iter()
        .find(|s| s.session_id == session_id)
        .ok_or("Session not found")?;

    if session.host_type != crate::platforms::session::HostType::Word {
        return Err(
            "AI content import is only supported for Word. Please select a Word session.".into(),
        );
    }

    let endpoint = ai_endpoint.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let api_key = ai_api_key.ok_or("AI API key is required")?;
    let model = ai_model.unwrap_or_else(|| "gpt-4o".to_string());

    // Step 1: Call AI with structured output prompt
    log::info!(
        "[AI->Word] Generating content via AI (model={}, prompt={})",
        model,
        &prompt.chars().take(60).collect::<String>()
    );
    let content_json = call_ai_for_content(&endpoint, &api_key, &model, &prompt).await?;

    // Step 2: Parse AI response into WordImportPlan operations
    let raw_operations = parse_ai_content_to_operations(&content_json)?;

    // Map AI operation kinds to Word importer kinds
    let operations: Vec<AiContentOperation> = raw_operations
        .into_iter()
        .map(|op| {
            // Preserve legacy displayFormula display flag BEFORE kind mapping
            let legacy_display = op.kind == "displayFormula";

            let kind = match op.kind.as_str() {
                "heading" => "heading".to_string(),
                "paragraph" => "paragraph".to_string(),
                "formula" | "displayFormula" => "formula".to_string(),
                "table" => "table".to_string(),
                "list" => "list-item".to_string(),
                "code" => "code".to_string(),
                other => {
                    log::warn!(
                        "[AI->Word] Unknown operation kind '{}', mapping to paragraph",
                        other
                    );
                    "paragraph".to_string()
                }
            };

            // Display: use AI value, fallback to legacy displayFormula flag
            let display = op.display.or(Some(legacy_display));

            // Heading: Word importer handles level->style mapping internally
            // Code: map to safe built-in style
            let style = if kind == "code" {
                Some("LaTeXSnipper Code Block".to_string())
            } else {
                None
            };

            AiContentOperation {
                kind,
                text: op.text,
                level: op.level,
                ordered: op.ordered,
                rows: op.rows,
                omml: op.omml,
                display,
                style,
            }
        })
        .collect();

    log::info!(
        "[AI->Word] Parsed {} operations from AI response",
        operations.len()
    );

    // Step 3: Convert LaTeX formulas to OMML, tracking failures
    let mut converted_ops = Vec::new();
    let mut diagnostics: Vec<String> = Vec::new();

    for mut op in operations {
        if op.kind == "formula" {
            if let Some(ref latex) = op.text {
                let latex_clone = latex.clone();
                match tokio::task::spawn_blocking(move || {
                    latexsnipper_conversion::DocumentConverter::convert_latex_string(
                        &latex_clone,
                        latexsnipper_conversion::OutputFormat::OMML,
                    )
                })
                .await
                {
                    Ok(Ok(omml)) => {
                        op.omml = Some(omml);
                        // Preserve display flag; default to false if not set
                        if op.display.is_none() {
                            op.display = Some(false);
                        }
                    }
                    Ok(Err(e)) => {
                        let msg = format!(
                            "Formula conversion failed: '{}' -> {}",
                            op.text.as_deref().unwrap_or(""),
                            e
                        );
                        log::warn!("[AI->Word] {}", msg);
                        diagnostics.push(msg);
                        continue; // Skip this operation
                    }
                    Err(e) => {
                        let msg = format!("Formula conversion task failed: {}", e);
                        log::warn!("[AI->Word] {}", msg);
                        diagnostics.push(msg);
                        continue;
                    }
                }
            } else {
                diagnostics.push("Formula operation missing text content".to_string());
                continue;
            }
        }
        converted_ops.push(op);
    }

    if converted_ops.is_empty() {
        return Err("AI generated no valid operations after filtering".into());
    }

    // Step 4: Build WordImportPlan and send via IMPORT_CONVERSATION
    let plan_id = format!("ai-{}", uuid_simple());
    let import_id = format!("import-{}", uuid_simple());
    let plan = crate::platforms::conversation_import::WordImportPlan {
        plan_id: plan_id.clone(),
        import_id: import_id.clone(),
        operations: converted_ops
            .iter()
            .map(
                |op| crate::platforms::conversation_import::WordImportOperation {
                    kind: op.kind.clone(),
                    text: op.text.clone(),
                    level: op.level,
                    ordered: op.ordered,
                    rows: op.rows.clone(),
                    omml: op.omml.clone(),
                    display: op.display,
                    style: op.style.clone(),
                },
            )
            .collect(),
        diagnostics: diagnostics
            .iter()
            .map(
                |d| crate::platforms::conversation_import::ImportDiagnostic {
                    code: "AI_FORMULA_CONVERSION".into(),
                    message: d.clone(),
                },
            )
            .collect(),
        can_commit: diagnostics.is_empty(),
        checksum: String::new(),
    };

    // Strict mode: reject if any formula conversion failed
    if !diagnostics.is_empty() {
        return Err(format!(
            "AI content has {} formula conversion error(s): {}",
            diagnostics.len(),
            diagnostics.join("; ")
        ));
    }

    // Require document identity for context protection
    let document_id = session.document_id.clone().ok_or(
        "Word destination document identity is unavailable. Please ensure a Word document is open.",
    )?;

    // Send IMPORT_CONVERSATION to Word
    let request_id = format!("cmd-{}", uuid_simple());
    let msg = DesktopMessage::ImportConversation {
        requestId: request_id.clone(),
        sessionId: session_id.clone(),
        expectedContextId: document_id,
        plan,
    };

    session_mgr
        .send_to_session(&session_id, msg)
        .await
        .map_err(|e| format!("Failed to send import conversation: {}", e))?;

    // Wait for Word to confirm import (with 30s timeout for large content)
    let rx = waiter.register(request_id).await;
    let result = match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(host_result)) => host_result,
        Ok(Err(_)) => {
            return Err("Import result channel disconnected".to_string());
        }
        Err(_) => {
            return Err("Import timed out waiting for Word response".to_string());
        }
    };

    if !result.success {
        return Err(format!(
            "Word import failed: {}",
            result.error.unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    log::info!(
        "[AI→Word] IMPORT_CONVERSATION confirmed with {} operations",
        converted_ops.len()
    );

    Ok(GenerateImportResult {
        plan_id,
        import_id,
        operation_count: converted_ops.len(),
        skipped_count: diagnostics.len(),
        diagnostics,
    })
}

/// Result of a generate-and-import operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImportResult {
    pub plan_id: String,
    pub import_id: String,
    pub operation_count: usize,
    pub skipped_count: usize,
    pub diagnostics: Vec<String>,
}

/// A single operation in the AI-generated content plan.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiContentOperation {
    /// Operation type: "paragraph", "heading", "formula", "table", "list", "code"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Heading level 1-6 (for "heading")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u32>,
    /// true for ordered list, false for bullet list (for "list")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordered: Option<bool>,
    /// Table rows (for "table")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<String>>>,
    /// OMML formula content (for "formula")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omml: Option<String>,
    /// true for display math, false for inline (for "formula")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<bool>,
    /// Word style name (for "heading"): "LaTeXSnipper Heading 1" etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

/// AI response wrapper — object with operations array.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct AiContentResponse {
    pub operations: Vec<AiContentOperation>,
}

/// Call AI to generate structured content as JSON operations.
async fn call_ai_for_content(
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let system_prompt = r#"You are a document content generator. Given a natural language request, output a JSON object with an "operations" array of operations that will be inserted into a Word document.

Output format: {"operations": [...]}

Each operation is an object with these fields:
- "kind": one of "paragraph", "heading", "formula", "table", "list", "code"
- "text": the text content (for paragraph, code) or LaTeX formula (for formula)
- "level": heading level 1-6 (for heading)
- "ordered": true for numbered list, false for bullet list (for list)
- "rows": array of arrays of strings (for table)
- "display": true for display math, false for inline (for formula)
- "style": Word style name like "LaTeXSnipper Heading 1", "LaTeXSnipper Quote", "LaTeXSnipper Code Block" (for heading, code)

Rules:
- Output ONLY the JSON object, no markdown, no explanation
- Use LaTeX for math formulas (e.g., "\\frac{a}{b}", "x^2")
- Tables should have consistent column counts
- Headings should form a logical document structure with proper levels
- Keep content concise and well-structured

Example output:
{"operations": [
  {"kind": "heading", "text": "Quadratic Formula", "level": 2, "style": "LaTeXSnipper Heading 2"},
  {"kind": "paragraph", "text": "The quadratic formula solves ax² + bx + c = 0:"},
  {"kind": "formula", "text": "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "display": true},
  {"kind": "paragraph", "text": "Where a, b, and c are coefficients."}
]}"#;

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 2048,
        "response_format": {"type": "json_object"},
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client creation failed: {}", e))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("AI API error ({}): {}", status, text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("AI API response parse failed: {}", e))?;

    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("AI response missing content")?
        .trim()
        .to_string();

    log::info!(
        "[AI→Word] AI content response: {}",
        &content.chars().take(100).collect::<String>()
    );
    Ok(content)
}

/// Parse AI JSON response into WordImportPlan operations.
fn parse_ai_content_to_operations(json_str: &str) -> Result<Vec<AiContentOperation>, String> {
    let cleaned = json_str.trim();

    // Handle markdown code blocks
    let json_str = if cleaned.starts_with("```json") {
        cleaned[7..].trim_end_matches("```").trim()
    } else if cleaned.starts_with("```") {
        cleaned[3..].trim_end_matches("```").trim()
    } else {
        cleaned
    };

    // Try to parse as object with operations array (preferred format)
    if let Ok(response) = serde_json::from_str::<AiContentResponse>(json_str) {
        if response.operations.is_empty() {
            return Err("AI returned empty operations array".to_string());
        }
        return Ok(response.operations);
    }

    // Fallback: try to parse as bare array (backward compatibility)
    let operations: Vec<AiContentOperation> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI response as JSON: {}", e))?;

    if operations.is_empty() {
        return Err("AI returned empty operations array".to_string());
    }

    Ok(operations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_latex_removes_code_blocks() {
        let input = "```latex\n\\frac{a}{b}\n```";
        assert_eq!(clean_ai_latex_response(input), "\\frac{a}{b}");
    }

    #[test]
    fn clean_latex_removes_dollar_delimiters() {
        let input = "$$\\frac{a}{b}$$";
        assert_eq!(clean_ai_latex_response(input), "\\frac{a}{b}");
    }

    #[test]
    fn parse_ai_content_basic() {
        let json = r#"{"operations": [{"kind": "heading", "text": "Title", "level": 1}]}"#;
        let ops = parse_ai_content_to_operations(json).unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].kind, "heading");
    }

    #[test]
    fn parse_ai_content_fallback_array() {
        let json = r#"[{"kind": "paragraph", "text": "Hello"}]"#;
        let ops = parse_ai_content_to_operations(json).unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].kind, "paragraph");
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
