//! Windows identity helpers for SID retrieval.
//!
//! Provides the current user's SID for Named Pipe naming and DACL configuration.

use std::sync::OnceLock;

/// Error type for security operations.
#[derive(Debug, Clone)]
pub enum NativeOfficeSecurityError {
    /// Failed to open process token.
    TokenOpenFailed,
    /// Failed to query token information.
    TokenQueryFailed,
    /// Failed to convert SID to string.
    SidConversionFailed,
    /// Failed to free allocated memory.
    MemoryFreeFailed,
}

impl std::fmt::Display for NativeOfficeSecurityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TokenOpenFailed => write!(f, "failed to open process token"),
            Self::TokenQueryFailed => write!(f, "failed to query token information"),
            Self::SidConversionFailed => write!(f, "failed to convert SID to string"),
            Self::MemoryFreeFailed => write!(f, "failed to free allocated memory"),
        }
    }
}

impl std::error::Error for NativeOfficeSecurityError {}

/// Get the current Windows user SID as a string.
/// Returns a stable identifier like `S-1-5-21-...-1001`.
///
/// This function uses the Windows Token API to get the real SID.
/// It will NOT fall back to username on failure.
pub fn current_user_sid() -> Result<String, NativeOfficeSecurityError> {
    static SID: OnceLock<Result<String, NativeOfficeSecurityError>> = OnceLock::new();
    SID.get_or_init(|| get_windows_user_sid()).clone()
}

/// Get the real Windows SID using the current process token.
#[cfg(target_os = "windows")]
fn get_windows_user_sid() -> Result<String, NativeOfficeSecurityError> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    unsafe {
        // Open current process token
        let mut token_handle: *mut std::ffi::c_void = std::ptr::null_mut();
        let result = OpenProcessToken(
            -1isize as *mut _, // GetCurrentProcess()
            0x0008,            // TOKEN_QUERY
            &mut token_handle,
        );

        if result == 0 || token_handle.is_null() {
            log::error!("[Identity] Failed to open process token");
            return Err(NativeOfficeSecurityError::TokenOpenFailed);
        }

        // Get required buffer size
        let mut return_length: u32 = 0;
        let _ = GetTokenInformation(
            token_handle,
            1, // TokenUser
            std::ptr::null_mut(),
            0,
            &mut return_length,
        );

        if return_length == 0 {
            CloseHandle(token_handle);
            log::error!("[Identity] Failed to get token information size");
            return Err(NativeOfficeSecurityError::TokenQueryFailed);
        }

        // Allocate buffer and get TokenUser
        let mut buffer = vec![0u8; return_length as usize];
        let result = GetTokenInformation(
            token_handle,
            1, // TokenUser
            buffer.as_mut_ptr() as *mut _,
            return_length,
            &mut return_length,
        );

        CloseHandle(token_handle);

        if result == 0 {
            log::error!("[Identity] Failed to get token information");
            return Err(NativeOfficeSecurityError::TokenQueryFailed);
        }

        // Parse TOKEN_USER structure
        // The SID pointer is at offset 0 of the TOKEN_USER structure
        let sid_ptr = *(buffer.as_ptr() as *const *mut std::ffi::c_void);

        // Convert SID to string using ConvertSidToStringSidW
        let mut sid_string: *mut u16 = std::ptr::null_mut();
        let result = ConvertSidToStringSidW(sid_ptr as *const _, &mut sid_string);

        if result == 0 || sid_string.is_null() {
            log::error!("[Identity] Failed to convert SID to string");
            return Err(NativeOfficeSecurityError::SidConversionFailed);
        }

        // Convert wide string to String
        let mut len = 0;
        while *sid_string.offset(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(sid_string, len as usize);
        let result = String::from_utf16_lossy(slice);

        // Free the string
        LocalFree(sid_string as *mut _);

        // Log only first 8 chars for security
        if result.len() > 8 {
            log::info!("[Identity] SID obtained: {}...", &result[..8]);
        } else {
            log::info!("[Identity] SID obtained");
        }

        Ok(result)
    }
}

/// Non-Windows stub - always returns error.
#[cfg(not(target_os = "windows"))]
fn get_windows_user_sid() -> Result<String, NativeOfficeSecurityError> {
    Err(NativeOfficeSecurityError::TokenOpenFailed)
}

// Windows API FFI declarations
#[cfg(target_os = "windows")]
extern "system" {
    fn OpenProcessToken(
        ProcessHandle: *mut std::ffi::c_void,
        DesiredAccess: u32,
        TokenHandle: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn GetTokenInformation(
        TokenHandle: *mut std::ffi::c_void,
        TokenInformationClass: u32,
        TokenInformation: *mut std::ffi::c_void,
        TokenInformationLength: u32,
        ReturnLength: *mut u32,
    ) -> i32;

    fn ConvertSidToStringSidW(Sid: *const std::ffi::c_void, StringSid: *mut *mut u16) -> i32;

    fn LocalFree(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;

    fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sid_format() {
        #[cfg(target_os = "windows")]
        {
            let sid = current_user_sid().unwrap();
            // On Windows, should return a SID starting with S-1-
            assert!(
                sid.starts_with("S-1-"),
                "SID should start with S-1-, got: {}",
                sid
            );
        }
    }
}
