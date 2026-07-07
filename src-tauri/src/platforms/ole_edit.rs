//! OLE Edit Session — Handles inbound Named Pipe connections from OLE Formula DLL.
//!
//! Windows-only. Raw Win32 FFI is used to avoid feature-flag issues.
//!
//! When a user double-clicks an OLE formula object in Office, the OLE DLL:
//!   1. Creates a Named Pipe Server (single duplex instance)
//!   2. Launches LaTeXSnipper Desktop with `--ole-edit \\.\pipe\LaTeXSnipper.OleEditSession.{token}`
//!   3. Waits for this module to connect and send an envelope
//!   4. Desktop opens the editor; on save, sends updated envelope back on the SAME pipe handle
//!
//! Architecture: single full-duplex connection — read envelope, then write response.
//! No second pipe connection (the server is single-instance).

use serde::{Deserialize, Serialize};

use super::pipe_protocol::FormulaPayload;

#[derive(Debug, Serialize, Deserialize)]
pub struct OleEnvelope {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "sessionType")]
    pub session_type: String,
    #[serde(rename = "formulaId")]
    pub formula_id: String,
    pub latex: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub revision: u32,
    /// Full canonical FormulaPayload JSON, if sent by the OLE DLL.
    /// Carries omml, render, presentation, source, storageMode etc.
    #[serde(rename = "payloadJson", default)]
    pub payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OleResponse {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<FormulaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latex: Option<String>,
}

/// Event payload sent to frontend when OLE double-click triggers editing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleEditRequest {
    pub formula_id: String,
    pub latex: String,
    pub session_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_json: Option<serde_json::Value>,
}

/// Event payload returned by frontend when user saves or cancels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleEditResult {
    pub action: String, // "save" or "cancel"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<FormulaPayload>,
}

type Handle = isize;

/// Handle an OLE edit session WITHIN the Tauri runtime.
/// Shows/focuses the editor, waits for user to save/cancel, writes result back to pipe.
pub async fn handle_ole_edit_session_with_app(
    app_handle: tauri::AppHandle,
    pipe_name: &str,
) -> Result<(), String> {
    use std::sync::mpsc;
    use tauri::{Emitter, Listener, Manager};

    let handle = connect_to_pipe(pipe_name)?;
    let envelope = read_envelope(handle)?;
    log::info!("[OleEdit] Received formula: formulaId={}", envelope.formula_id);

    // Use formula_id as session token for matching results
    let session_token = envelope.formula_id.clone();

    // Show/focus the main window
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        log::warn!("[OleEdit] Main window not found");
    }

    // Create a oneshot channel to receive the editor result
    let (tx, rx) = mpsc::sync_channel::<OleEditResult>(1);
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    // Listen for the editor result from frontend
    let tx_clone = tx.clone();
    let token_clone = session_token.clone();
    let _listener = app_handle.listen(format!("ole-edit-result-{}", token_clone), move |event| {
        if let Ok(result) = serde_json::from_str::<OleEditResult>(&event.payload()) {
            if let Some(sender) = tx_clone.lock().unwrap().take() {
                let _ = sender.send(result);
            }
        }
    });

    // Send edit request to frontend with full payload if available
    let request = OleEditRequest {
        formula_id: envelope.formula_id.clone(),
        latex: envelope.latex.clone(),
        session_token: session_token.clone(),
        payload_json: envelope.payload_json.clone(),
    };

    app_handle.emit("ole-edit-open", &request).map_err(|e| format!("Failed to emit: {}", e))?;

    // Wait for result with timeout (10 minutes)
    let timeout = std::time::Duration::from_secs(600);
    match rx.recv_timeout(timeout) {
        Ok(result) => {
            let response = match result.action.as_str() {
                "save" => {
                    // Extract full FormulaPayload fields from payload_json if available
                    let payload = envelope.payload_json.as_ref();
                    let omml = payload
                        .and_then(|v| v.get("omml"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let display_val = payload
                        .and_then(|v| v.get("display"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("inline")
                        .to_string();
                    let present = payload.and_then(|v| v.get("presentation")).cloned();
                    let render = payload.and_then(|v| v.get("render")).cloned();
                    let src = payload.and_then(|v| v.get("source")).cloned();
                    let storage = payload
                        .and_then(|v| v.get("storageMode"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("ole")
                        .to_string();

                    let formula = result.formula.unwrap_or_else(|| FormulaPayload {
                        schema_version: Some(envelope.schema_version as i32),
                        formula_id: envelope.formula_id.clone(),
                        latex: envelope.latex.clone(),
                        omml,
                        display: display_val,
                        presentation: present.and_then(|v| serde_json::from_value(v).ok()),
                        render: render.and_then(|v| serde_json::from_value(v).ok()),
                        source: src.and_then(|v| serde_json::from_value(v).ok()),
                        storage_mode: Some(storage),
                        revision: envelope.revision as i32,
                    });
                    OleResponse {
                        protocol_version: 2,
                        action: "save".to_string(),
                        formula: Some(formula),
                        formula_id: Some(envelope.formula_id.clone()),
                        latex: Some(envelope.latex.clone()),
                    }
                }
                _ => {
                    // Cancel
                    OleResponse {
                        protocol_version: 2,
                        action: "cancel".to_string(),
                        formula: None,
                        formula_id: None,
                        latex: None,
                    }
                }
            };

            write_response_on_handle(handle, &response)?;
            close_handle(handle);
            log::info!("[OleEdit] Response sent: {}", response.action);
            Ok(())
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            log::warn!("[OleEdit] Edit session timed out");
            let response = OleResponse {
                protocol_version: 2,
                action: "timeout".to_string(),
                formula: None,
                formula_id: None,
                latex: None,
            };
            write_response_on_handle(handle, &response)?;
            close_handle(handle);
            Ok(())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            log::error!("[OleEdit] Channel disconnected");
            let _ = write_response_on_handle(handle, &OleResponse {
                protocol_version: 2,
                action: "cancel".to_string(),
                formula: None,
                formula_id: None,
                latex: None,
            });
            close_handle(handle);
            Ok(())
        }
    }
}

/// Open editor and produce a response. Legacy fallback — should not be called
/// from the main path.
fn open_editor_and_build_response(envelope: &OleEnvelope) -> Result<OleResponse, String> {
    // This path should only be used if app_handle is not available.
    // Extract fields from payload_json when possible
    let payload = envelope.payload_json.as_ref();
    let omml = payload
        .and_then(|v| v.get("omml"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let display_val = payload
        .and_then(|v| v.get("display"))
        .and_then(|v| v.as_str())
        .unwrap_or("inline")
        .to_string();
    let present = payload.and_then(|v| v.get("presentation")).cloned();
    let render = payload.and_then(|v| v.get("render")).cloned();
    let src = payload.and_then(|v| v.get("source")).cloned();
    let storage = payload
        .and_then(|v| v.get("storageMode"))
        .and_then(|v| v.as_str())
        .unwrap_or("ole")
        .to_string();

    let formula = FormulaPayload {
        schema_version: Some(envelope.schema_version as i32),
        formula_id: envelope.formula_id.clone(),
        latex: envelope.latex.clone(),
        omml,
        display: display_val,
        presentation: present.and_then(|v| serde_json::from_value(v).ok()),
        render: render.and_then(|v| serde_json::from_value(v).ok()),
        source: src.and_then(|v| serde_json::from_value(v).ok()),
        storage_mode: Some(storage),
        revision: envelope.revision as i32,
    };
    Ok(OleResponse {
        protocol_version: 2,
        action: "save".to_string(),
        formula: Some(formula),
        formula_id: Some(envelope.formula_id.clone()),
        latex: Some(envelope.latex.clone()),
    })
}

/// Write response back on the SAME handle used for reading.
fn write_response_on_handle(handle: Handle, response: &OleResponse) -> Result<(), String> {
    let json = serde_json::to_string(response).map_err(|e| format!("Serialize: {}", e))?;
    let json_u16: Vec<u16> = json.encode_utf16().collect();
    let payload_size = (json_u16.len() * 2 + 2) as u32; // include null terminator

    // Write size
    let mut written: u32 = 0;
    if unsafe { WriteFile(handle, &payload_size as *const u32 as *const u8, 4, &mut written, std::ptr::null_mut()) } == 0 || written != 4 {
        return Err(format!("Failed to write response size: written={} err={}", written, unsafe { GetLastError() }));
    }

    // Write UTF-16 payload
    if !json_u16.is_empty() {
        let to_write = (json_u16.len() * 2) as u32;
        written = 0;
        if unsafe { WriteFile(handle, json_u16.as_ptr() as *const u8, to_write, &mut written, std::ptr::null_mut()) } == 0 || written != to_write {
            return Err(format!("Failed to write response payload: written={} err={}", written, unsafe { GetLastError() }));
        }
    }

    // Write null terminator
    let null: u16 = 0;
    written = 0;
    if unsafe { WriteFile(handle, &null as *const u16 as *const u8, 2, &mut written, std::ptr::null_mut()) } == 0 || written != 2 {
        return Err(format!("Failed to write null terminator: written={} err={}", written, unsafe { GetLastError() }));
    }

    Ok(())
}

fn connect_to_pipe(pipe_name: &str) -> Result<Handle, String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(pipe_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0, // no sharing — exclusive access
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL, // synchronous I/O
            std::ptr::null_mut(),
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        return Err(format!("Failed to connect to pipe: error={}", unsafe { GetLastError() }));
    }
    Ok(handle)
}

fn read_envelope(handle: Handle) -> Result<OleEnvelope, String> {
    let mut size_buf = [0u8; 4];
    let mut read_bytes: u32 = 0;
    if unsafe { ReadFile(handle, size_buf.as_mut_ptr(), 4, &mut read_bytes, std::ptr::null_mut()) } == 0 || read_bytes != 4 {
        let err = unsafe { GetLastError() };
        return Err(format!("Failed to read envelope size: read={} err={}", read_bytes, err));
    }
    let payload_size = u32::from_le_bytes(size_buf) as usize;
    const MAX_PAYLOAD: usize = 4 * 1024 * 1024; // 4 MiB for full FormulaPayload
    if payload_size == 0 || payload_size > MAX_PAYLOAD {
        return Err(format!("Invalid envelope size: {} (max {})", payload_size, MAX_PAYLOAD));
    }

    let mut payload_buf = vec![0u8; payload_size];
    read_bytes = 0;
    if unsafe { ReadFile(handle, payload_buf.as_mut_ptr(), payload_size as u32, &mut read_bytes, std::ptr::null_mut()) } == 0 || read_bytes as usize != payload_size {
        let err = unsafe { GetLastError() };
        return Err(format!("Failed to read envelope payload: read={} err={}", read_bytes, err));
    }

    let u16_slice: &[u16] = unsafe {
        std::slice::from_raw_parts(payload_buf.as_ptr() as *const u16, payload_buf.len() / 2)
    };
    let json_wide: Vec<u16> = u16_slice.iter().copied().take_while(|&c| c != 0).collect();
    let json = String::from_utf16(&json_wide).map_err(|e| format!("Invalid UTF-16: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("JSON parse: {}", e))
}

fn close_handle(handle: Handle) {
    if handle != INVALID_HANDLE_VALUE {
        unsafe { CloseHandle(handle); }
    }
}

// ── Raw Win32 FFI ──

const INVALID_HANDLE_VALUE: isize = -1;
const GENERIC_READ: u32 = 0x80000000;
const GENERIC_WRITE: u32 = 0x40000000;
const OPEN_EXISTING: u32 = 3;
const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

extern "system" {
    fn CreateFileW(
        lpFileName: *const u16,
        dwDesiredAccess: u32,
        dwShareMode: u32,
        lpSecurityAttributes: *mut std::ffi::c_void,
        dwCreationDisposition: u32,
        dwFlagsAndAttributes: u32,
        hTemplateFile: *mut std::ffi::c_void,
    ) -> isize;

    fn ReadFile(
        hFile: isize,
        lpBuffer: *mut u8,
        nNumberOfBytesToRead: u32,
        lpNumberOfBytesRead: *mut u32,
        lpOverlapped: *mut std::ffi::c_void,
    ) -> i32;

    fn WriteFile(
        hFile: isize,
        lpBuffer: *const u8,
        nNumberOfBytesToWrite: u32,
        lpNumberOfBytesWritten: *mut u32,
        lpOverlapped: *mut std::ffi::c_void,
    ) -> i32;

    fn CloseHandle(hObject: isize) -> i32;

    fn GetLastError() -> u32;
}
