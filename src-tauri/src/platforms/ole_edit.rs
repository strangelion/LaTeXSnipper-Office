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

type Handle = isize;

/// Handle an OLE edit session over a single duplex pipe:
///   1. Connect
///   2. Read envelope (formulaId + latex)
///   3. Open editor and build response
///   4. Write response back on the SAME handle
///   5. Close
pub fn handle_ole_edit_session(pipe_name: &str) -> Result<(), String> {
    let handle = connect_to_pipe(pipe_name)?;
    let envelope = read_envelope(handle)?;
    log::info!("[OleEdit] Received formula: formulaId={}", envelope.formula_id);

    let response = open_editor_and_build_response(&envelope)?;

    write_response_on_handle(handle, &response)?;
    close_handle(handle);
    log::info!("[OleEdit] Response sent back to OLE DLL.");
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

/// Open editor and produce a response. Real implementation would open the
/// editor window and wait for user action, then return a full FormulaPayload.
fn open_editor_and_build_response(envelope: &OleEnvelope) -> Result<OleResponse, String> {
    // TODO: Open actual editor, wait for user to save/cancel.
    // The response must carry a full FormulaPayload on save.
    // For now, echo back the original data as a save placeholder.
    let formula = FormulaPayload {
        schema_version: Some(envelope.schema_version as i32),
        formula_id: envelope.formula_id.clone(),
        latex: envelope.latex.clone(),
        omml: String::new(),
        display: "inline".to_string(),
        presentation: None,
        render: None,
        source: None,
        storage_mode: Some("ole".to_string()),
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
