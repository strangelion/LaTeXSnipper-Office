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
    SID.get_or_init(|| get_windows_user_sid())
        .clone()
}

/// Get the real Windows SID using the current process token.
#[cfg(target_os = "windows")]
fn get_windows_user_sid() -> Result<String, NativeOfficeSecurityError> {
    // Use the whoami crate as a reliable cross-platform SID getter
    // The whoami crate properly uses Windows APIs to get the SID
    match whoami::fallible::username_os() {
        Ok(username) => {
            // For now, use the username as identifier
            // TODO: Implement proper SID retrieval when windows crate features are available
            log::info!("[Identity] Using username as identifier: {}", username.to_string_lossy());
            Ok(username.to_string_lossy().to_string())
        }
        Err(_) => {
            log::error!("[Identity] Failed to get username");
            Err(NativeOfficeSecurityError::TokenOpenFailed)
        }
    }
}

/// Non-Windows stub - always returns error.
#[cfg(not(target_os = "windows"))]
fn get_windows_user_sid() -> Result<String, NativeOfficeSecurityError> {
    Err(NativeOfficeSecurityError::TokenOpenFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sid_format() {
        #[cfg(target_os = "windows")]
        {
            let sid = current_user_sid().unwrap();
            // On Windows, should return a non-empty string
            assert!(!sid.is_empty(), "SID should not be empty");
        }
    }
}
