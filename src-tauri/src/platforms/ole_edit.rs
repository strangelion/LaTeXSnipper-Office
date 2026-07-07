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

use std::io::Read;
use serde::{Deserialize, Serialize};

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
    pub action: String,
    pub latex: Option<String>,
    pub formula_id: Option<String>,
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
            FILE_FLAG_OVERLAPPED,
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
    if unsafe { ReadFile(handle, size_buf.as_mut_ptr(), 4, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
        // Use overlapped I/O with GetOverlappedResult or fallback to synchronous
        // For simplicity, the C++ side writes synchronously so we read synchronously
        return Err("Failed to read envelope size".to_string());
    }
    let payload_size = u32::from_le_bytes(size_buf) as usize;
    if payload_size == 0 || payload_size > 65536 {
        return Err("Invalid envelope size".to_string());
    }

    let mut payload_buf = vec![0u8; payload_size];
    if unsafe { ReadFile(handle, payload_buf.as_mut_ptr(), payload_size as u32, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
        return Err("Failed to read envelope payload".to_string());
    }

    let u16_slice: &[u16] = unsafe {
        std::slice::from_raw_parts(payload_buf.as_ptr() as *const u16, payload_buf.len() / 2)
    };
    let json_wide: Vec<u16> = u16_slice.iter().copied().take_while(|&c| c != 0).collect();
    let json = String::from_utf16(&json_wide).map_err(|e| format!("Invalid UTF-16: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("JSON parse: {}", e))
}

/// Open editor and produce a response. Real implementation would open the
/// editor window and wait for user action.
fn open_editor_and_build_response(envelope: &OleEnvelope) -> Result<OleResponse, String> {
    // TODO: Open actual editor, wait for user to save/cancel
    // For now, echo the original latex as a "save" (placeholder)
    Ok(OleResponse {
        action: "save".to_string(),
        latex: Some(envelope.latex.clone()),
        formula_id: Some(envelope.formula_id.clone()),
    })
}

/// Write response back on the SAME handle used for reading.
fn write_response_on_handle(handle: Handle, response: &OleResponse) -> Result<(), String> {
    let json = serde_json::to_string(response).map_err(|e| format!("Serialize: {}", e))?;
    let json_u16: Vec<u16> = json.encode_utf16().collect();
    let payload_size = (json_u16.len() * 2 + 2) as u32; // include null terminator

    // Write size
    let mut written: u32 = 0;
    if unsafe { WriteFile(handle, &payload_size as *const u32 as *const u8, 4, &mut written, std::ptr::null_mut()) } == 0 {
        return Err(format!("Failed to write response size: err={}", unsafe { GetLastError() }));
    }

    // Write UTF-16 payload
    if !json_u16.is_empty() {
        if unsafe { WriteFile(handle, json_u16.as_ptr() as *const u8, (json_u16.len() * 2) as u32, &mut written, std::ptr::null_mut()) } == 0 {
            return Err(format!("Failed to write response payload: err={}", unsafe { GetLastError() }));
        }
    }

    // Write null terminator
    let null: u16 = 0;
    if unsafe { WriteFile(handle, &null as *const u16 as *const u8, 2, &mut written, std::ptr::null_mut()) } == 0 {
        return Err(format!("Failed to write null terminator: err={}", unsafe { GetLastError() }));
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
const FILE_FLAG_OVERLAPPED: u32 = 0x40000000;

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
