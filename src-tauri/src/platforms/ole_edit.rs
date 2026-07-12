//! Windows OLE edit transport.
//!
//! One full-duplex pipe carries request, response, and native commit ACK. The
//! desktop accepts one active editor session; later requests receive
//! `OLE_EDIT_BUSY` instead of replacing the current frontend state.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

use super::pipe_protocol::FormulaPayload;

pub const OLE_EDIT_PROTOCOL_VERSION: u32 = 3;
const OLE_EDIT_DISPATCHER_PIPE: &str = r"\\.\pipe\LaTeXSnipper.OleEditDispatcher.v1";
const OLE_EDIT_PIPE_PREFIX: &str = r"\\.\pipe\LaTeXSnipper.OleEditSession.";
const MAX_DISPATCHER_PIPE_NAME_BYTES: usize = 4096;
const MAX_OLE_EDIT_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_ACK_BYTES: usize = 64 * 1024;
const EDIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
static OLE_EDIT_ACTIVE: AtomicBool = AtomicBool::new(false);

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
    #[serde(rename = "payloadJson", default)]
    pub payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OleResponse {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    pub action: String,
    #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<FormulaPayload>,
    #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
    pub formula_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OleCommitAck {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    success: bool,
    #[serde(rename = "errorCode", default)]
    error_code: String,
    hresult: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleEditRequest {
    pub formula_id: String,
    pub latex: String,
    pub session_token: String,
    pub revision: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleEditResult {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<FormulaPayload>,
}

type Handle = *mut std::ffi::c_void;

struct OwnedHandle(Handle);

unsafe impl Send for OwnedHandle {}

impl OwnedHandle {
    fn raw(&self) -> Handle {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.0 != INVALID_HANDLE_VALUE && !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

struct ActiveSessionGuard;

impl ActiveSessionGuard {
    fn acquire() -> Option<Self> {
        OLE_EDIT_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for ActiveSessionGuard {
    fn drop(&mut self) {
        OLE_EDIT_ACTIVE.store(false, Ordering::Release);
    }
}

pub async fn start_ole_edit_dispatcher(app_handle: tauri::AppHandle) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ServerOptions;

    let mut first = true;
    loop {
        let mut security =
            match super::pipe_security::PipeSecurityDescriptor::current_user_and_system() {
                Ok(security) => security,
                Err(error) => {
                    log::error!("[OleEdit] Cannot create dispatcher security descriptor: {error}");
                    return;
                }
            };
        let server = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    OLE_EDIT_DISPATCHER_PIPE,
                    security.as_raw_security_attributes(),
                )
        };
        first = false;
        let mut server = match server {
            Ok(server) => server,
            Err(error) => {
                log::error!("[OleEdit] Cannot create dispatcher pipe: {error}; retrying");
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };
        if let Err(error) = server.connect().await {
            log::warn!("[OleEdit] Dispatcher connection failed: {error}");
            continue;
        }

        let request = async {
            let mut size = [0u8; 4];
            server.read_exact(&mut size).await?;
            let size = u32::from_le_bytes(size) as usize;
            if size == 0 || size > MAX_DISPATCHER_PIPE_NAME_BYTES || !size.is_multiple_of(2) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "invalid OLE edit pipe name size",
                ));
            }
            let mut bytes = vec![0u8; size];
            server.read_exact(&mut bytes).await?;
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            let pipe_name = String::from_utf16(&units).map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "invalid OLE edit pipe name",
                )
            })?;
            if !pipe_name.starts_with(OLE_EDIT_PIPE_PREFIX) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "unexpected OLE edit pipe name",
                ));
            }
            Ok(pipe_name)
        }
        .await;

        match request {
            Ok(pipe_name) => {
                if let Err(error) = server.write_all(&1u32.to_le_bytes()).await {
                    log::warn!("[OleEdit] Dispatcher acknowledgement failed: {error}");
                    continue;
                }
                let handler = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = handle_ole_edit_session_with_app(handler, &pipe_name).await
                    {
                        log::error!("[OleEdit] Dispatched edit session failed: {error}");
                    }
                });
            }
            Err(error) => log::warn!("[OleEdit] Dispatcher rejected request: {error}"),
        }
    }
}

pub async fn handle_ole_edit_session_with_app(
    app_handle: tauri::AppHandle,
    pipe_name: &str,
) -> Result<(), String> {
    use tauri::{Emitter, Listener, Manager};

    let handle = connect_to_pipe(pipe_name)?;
    let envelope = read_envelope(&handle)?;
    if envelope.protocol_version != OLE_EDIT_PROTOCOL_VERSION {
        write_response(&handle, &error_response("OLE_EDIT_PROTOCOL_ERROR"))?;
        return Err(format!(
            "OLE edit protocol mismatch: expected {}, received {}",
            OLE_EDIT_PROTOCOL_VERSION, envelope.protocol_version
        ));
    }

    let Some(_active_guard) = ActiveSessionGuard::acquire() else {
        write_response(&handle, &error_response("OLE_EDIT_BUSY"))?;
        return Ok(());
    };
    let session_token = extract_session_token_from_pipe_name(pipe_name)?;

    // Guard that emits ole-edit-session-ended when dropped (covers save, cancel, timeout, error).
    struct FrontendOleSessionGuard {
        app_handle: tauri::AppHandle,
        session_token: String,
    }
    impl Drop for FrontendOleSessionGuard {
        fn drop(&mut self) {
            use tauri::Emitter;
            let _ = self.app_handle.emit(
                "ole-edit-session-ended",
                serde_json::json!({ "sessionToken": self.session_token }),
            );
        }
    }
    let _frontend_session_guard = FrontendOleSessionGuard {
        app_handle: app_handle.clone(),
        session_token: session_token.clone(),
    };

    log::info!(
        "[OleEdit] Received formula: formulaId={} revision={}",
        envelope.formula_id,
        envelope.revision
    );

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(error) = window.show() {
            log::warn!("[OleEdit] Cannot show main window: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::warn!("[OleEdit] Cannot focus main window: {error}");
        }
    } else {
        log::warn!("[OleEdit] Main window not found");
    }

    let (sender, receiver) = tokio::sync::oneshot::channel::<OleEditResult>();
    let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
    let listener_sender = sender.clone();
    let listener_id = app_handle.listen(format!("ole-edit-result-{session_token}"), move |event| {
        match serde_json::from_str::<OleEditResult>(event.payload()) {
            Ok(result) => {
                if let Ok(mut slot) = listener_sender.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(result);
                    }
                }
            }
            Err(error) => log::warn!("[OleEdit] Invalid frontend result: {error}"),
        }
    });

    let request = OleEditRequest {
        formula_id: envelope.formula_id.clone(),
        latex: envelope.latex.clone(),
        session_token: session_token.clone(),
        revision: envelope.revision,
        payload_json: envelope.payload_json.clone(),
    };
    if let Err(error) = app_handle.emit("ole-edit-open", &request) {
        app_handle.unlisten(listener_id);
        write_response(&handle, &error_response("OLE_EDIT_FRONTEND_UNAVAILABLE"))?;
        return Err(format!("Failed to emit OLE edit request: {error}"));
    }

    let result = tokio::time::timeout(EDIT_TIMEOUT, receiver).await;
    app_handle.unlisten(listener_id);

    let response = match result {
        Ok(Ok(result)) if result.action == "save" => validate_save_result(&envelope, result)?,
        Ok(Ok(_)) => cancel_response(None),
        Ok(Err(_)) => cancel_response(Some("OLE_EDIT_CHANNEL_CLOSED")),
        Err(_) => cancel_response(Some("OLE_EDIT_TIMEOUT")),
    };
    let is_save = response.action == "save";
    let response_error = response.error_code.clone();
    write_response(&handle, &response)?;

    if let Some(error_code) = response_error {
        let event_name = format!("ole-edit-commit-{session_token}");
        app_handle
            .emit(
                &event_name,
                OleCommitAck {
                    protocol_version: OLE_EDIT_PROTOCOL_VERSION,
                    success: false,
                    error_code,
                    hresult: 0x8004_0203,
                },
            )
            .map_err(|error| format!("Failed to emit OLE validation failure: {error}"))?;
        return Ok(());
    }

    let ack = tokio::task::spawn_blocking(move || read_commit_ack(&handle))
        .await
        .map_err(|error| format!("OLE commit ACK task failed: {error}"))??;
    if ack.protocol_version != OLE_EDIT_PROTOCOL_VERSION {
        return Err(format!(
            "OLE commit ACK version mismatch: {}",
            ack.protocol_version
        ));
    }
    if is_save {
        let event_name = format!("ole-edit-commit-{session_token}");
        app_handle
            .emit(&event_name, &ack)
            .map_err(|error| format!("Failed to emit OLE commit ACK: {error}"))?;
    }
    Ok(())
}

fn validate_save_result(
    envelope: &OleEnvelope,
    result: OleEditResult,
) -> Result<OleResponse, String> {
    let formula = result
        .formula
        .ok_or_else(|| "OLE save result is missing formula payload".to_string())?;
    if formula.formula_id != envelope.formula_id {
        return Ok(error_response("OLE_EDIT_FORMULA_ID_MISMATCH"));
    }
    let expected_revision = envelope.revision.saturating_add(1);
    if formula.revision < 0 || formula.revision as u32 != expected_revision {
        return Ok(error_response("OLE_EDIT_REVISION_CONFLICT"));
    }
    let latex = formula.latex.clone();
    Ok(OleResponse {
        protocol_version: OLE_EDIT_PROTOCOL_VERSION,
        action: "save".to_string(),
        error_code: None,
        formula: Some(formula),
        formula_id: Some(envelope.formula_id.clone()),
        latex: Some(latex),
    })
}

fn error_response(error_code: &str) -> OleResponse {
    OleResponse {
        protocol_version: OLE_EDIT_PROTOCOL_VERSION,
        action: "error".to_string(),
        error_code: Some(error_code.to_string()),
        formula: None,
        formula_id: None,
        latex: None,
    }
}

fn cancel_response(error_code: Option<&str>) -> OleResponse {
    OleResponse {
        protocol_version: OLE_EDIT_PROTOCOL_VERSION,
        action: "cancel".to_string(),
        error_code: error_code.map(str::to_string),
        formula: None,
        formula_id: None,
        latex: None,
    }
}

fn extract_session_token_from_pipe_name(pipe_name: &str) -> Result<String, String> {
    let token = pipe_name
        .strip_prefix(OLE_EDIT_PIPE_PREFIX)
        .ok_or_else(|| format!("Cannot extract session token from pipe name: {pipe_name}"))?;
    if token.is_empty() {
        return Err("Empty OLE edit session token".to_string());
    }
    Ok(token.to_string())
}

fn connect_to_pipe(pipe_name: &str) -> Result<OwnedHandle, String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(pipe_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "Failed to connect to OLE edit pipe: error={}",
            unsafe { GetLastError() }
        ));
    }
    Ok(OwnedHandle(handle))
}

fn read_envelope(handle: &OwnedHandle) -> Result<OleEnvelope, String> {
    let bytes = read_frame(handle, MAX_OLE_EDIT_PAYLOAD_BYTES, "envelope")?;
    let json = decode_utf16_frame(&bytes, "envelope")?;
    serde_json::from_str(&json).map_err(|error| format!("OLE envelope JSON parse failed: {error}"))
}

fn write_response(handle: &OwnedHandle, response: &OleResponse) -> Result<(), String> {
    let json = serde_json::to_string(response)
        .map_err(|error| format!("OLE response serialization failed: {error}"))?;
    let mut bytes = Vec::with_capacity(json.len() * 2 + 2);
    for unit in json.encode_utf16().chain(std::iter::once(0)) {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    if bytes.len() > MAX_OLE_EDIT_PAYLOAD_BYTES {
        return Err(format!(
            "OLE response exceeds {} bytes",
            MAX_OLE_EDIT_PAYLOAD_BYTES
        ));
    }
    write_exact(
        handle.raw(),
        &(bytes.len() as u32).to_le_bytes(),
        "response size",
    )?;
    write_exact(handle.raw(), &bytes, "response body")
}

fn read_commit_ack(handle: &OwnedHandle) -> Result<OleCommitAck, String> {
    let bytes = read_frame(handle, MAX_ACK_BYTES, "commit ACK")?;
    let json = decode_utf16_frame(&bytes, "commit ACK")?;
    serde_json::from_str(&json)
        .map_err(|error| format!("OLE commit ACK JSON parse failed: {error}"))
}

fn read_frame(handle: &OwnedHandle, max_size: usize, operation: &str) -> Result<Vec<u8>, String> {
    let mut size = [0u8; 4];
    read_exact(handle.raw(), &mut size, &format!("{operation} size"))?;
    let size = u32::from_le_bytes(size) as usize;
    if size < 2 || size > max_size || !size.is_multiple_of(2) {
        return Err(format!("Invalid {operation} size: {size}"));
    }
    let mut bytes = vec![0u8; size];
    read_exact(handle.raw(), &mut bytes, operation)?;
    Ok(bytes)
}

fn decode_utf16_frame(bytes: &[u8], operation: &str) -> Result<String, String> {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    if units.last() != Some(&0) {
        return Err(format!("{operation} is not null terminated"));
    }
    String::from_utf16(&units[..units.len() - 1])
        .map_err(|error| format!("Invalid UTF-16 in {operation}: {error}"))
}

fn read_exact(handle: Handle, buffer: &mut [u8], operation: &str) -> Result<(), String> {
    let mut offset = 0usize;
    while offset < buffer.len() {
        let mut transferred = 0u32;
        let remaining = u32::try_from(buffer.len() - offset)
            .map_err(|_| format!("{operation} is too large"))?;
        let ok = unsafe {
            ReadFile(
                handle,
                buffer[offset..].as_mut_ptr(),
                remaining,
                &mut transferred,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 && unsafe { GetLastError() } != ERROR_MORE_DATA {
            return Err(format!(
                "Failed to read {operation}: offset={offset} error={}",
                unsafe { GetLastError() }
            ));
        }
        if transferred == 0 {
            return Err(format!("Unexpected EOF while reading {operation}"));
        }
        offset += transferred as usize;
    }
    Ok(())
}

fn write_exact(handle: Handle, buffer: &[u8], operation: &str) -> Result<(), String> {
    let mut offset = 0usize;
    while offset < buffer.len() {
        let mut transferred = 0u32;
        let remaining = u32::try_from(buffer.len() - offset)
            .map_err(|_| format!("{operation} is too large"))?;
        let ok = unsafe {
            WriteFile(
                handle,
                buffer[offset..].as_ptr(),
                remaining,
                &mut transferred,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(format!(
                "Failed to write {operation}: offset={offset} error={}",
                unsafe { GetLastError() }
            ));
        }
        if transferred == 0 {
            return Err(format!("Zero-byte write while writing {operation}"));
        }
        offset += transferred as usize;
    }
    Ok(())
}

const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
const GENERIC_READ: u32 = 0x80000000;
const GENERIC_WRITE: u32 = 0x40000000;
const OPEN_EXISTING: u32 = 3;
const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
const ERROR_MORE_DATA: u32 = 234;

extern "system" {
    fn CreateFileW(
        lp_file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *mut std::ffi::c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: *mut std::ffi::c_void,
    ) -> Handle;
    fn ReadFile(
        file: Handle,
        buffer: *mut u8,
        bytes_to_read: u32,
        bytes_read: *mut u32,
        overlapped: *mut std::ffi::c_void,
    ) -> i32;
    fn WriteFile(
        file: Handle,
        buffer: *const u8,
        bytes_to_write: u32,
        bytes_written: *mut u32,
        overlapped: *mut std::ffi::c_void,
    ) -> i32;
    fn CloseHandle(object: Handle) -> i32;
    fn GetLastError() -> u32;
}
