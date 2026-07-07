//! OLE Edit Session — Handles inbound Named Pipe connections from OLE Formula DLL.
//!
//! Windows-only. Raw Win32 FFI is used to avoid feature-flag issues.
//!
//! When a user double-clicks an OLE formula object in Office, the OLE DLL:
//!   1. Creates a Named Pipe Server
//!   2. Launches LaTeXSnipper Desktop with `--ole-edit \\.\pipe\LaTeXSnipper.OleEditSession.{token}`
//!   3. Waits for this module to connect
//!   4. Sends the formula envelope
//!   5. This module opens the editor; on save, sends updated envelope back

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

/// Handle an OLE edit session: connect to the named pipe, read envelope,
/// open editor, send response back.
pub fn handle_ole_edit_session(pipe_name: &str) -> Result<(), String> {
    // 1. Connect
    let handle = connect_to_pipe(pipe_name)?;
    // 2. Read
    let envelope = read_envelope(handle)?;
    log::info!("[OleEdit] Received formula: formulaId={}", envelope.formula_id);

    // 3. Build response (real impl opens editor)
    let response = OleResponse {
        action: "save".to_string(),
        latex: Some(envelope.latex),
        formula_id: Some(envelope.formula_id),
    };

    // 4. Send response
    send_response(pipe_name, &response)?;
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
            FILE_SHARE_READ | FILE_SHARE_WRITE,
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

fn send_response(pipe_name: &str, response: &OleResponse) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = std::ffi::OsStr::new(pipe_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_WRITE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!("Failed to connect for response: err={}", unsafe { GetLastError() }));
    }

    let json = serde_json::to_string(response).map_err(|e| format!("Serialize: {}", e))?;
    let json_u16: Vec<u16> = json.encode_utf16().collect();
    let payload_size = (json_u16.len() * 2 + 2) as u32;

    // Write size
    unsafe {
        WriteFile(handle, &payload_size as *const u32 as *const u8, 4, std::ptr::null_mut(), std::ptr::null_mut());
    }
    // Write UTF-16 payload
    if json_u16.is_empty() {
        unsafe {
            WriteFile(handle, &0u16 as *const u16 as *const u8, 2, std::ptr::null_mut(), std::ptr::null_mut());
        }
        return Ok(());
    }
    unsafe {
        WriteFile(handle, json_u16.as_ptr() as *const u8, (json_u16.len() * 2) as u32, std::ptr::null_mut(), std::ptr::null_mut());
        WriteFile(handle, &0u16 as *const u16 as *const u8, 2, std::ptr::null_mut(), std::ptr::null_mut());
    }
    Ok(())
}

// ── Raw Win32 FFI ──

const INVALID_HANDLE_VALUE: isize = -1;
const GENERIC_READ: u32 = 0x80000000;
const GENERIC_WRITE: u32 = 0x40000000;
const FILE_SHARE_READ: u32 = 1;
const FILE_SHARE_WRITE: u32 = 2;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_OVERLAPPED: u32 = 0x40000000;
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

    fn GetLastError() -> u32;
}
