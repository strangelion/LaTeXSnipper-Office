//! Windows ACL helpers for Named Pipe access control.
//!
//! Restricts pipe access to the current user SID + SYSTEM only.

use std::sync::OnceLock;

use super::windows_identity::{current_user_sid, NativeOfficeSecurityError};

/// Get the current Windows user SID as a string.
/// Returns a stable identifier like `S-1-5-21-...-1001`.
///
/// Returns error if SID cannot be obtained (no fallback to username).
pub fn pipe_sid() -> Result<String, NativeOfficeSecurityError> {
    static SID: OnceLock<String> = OnceLock::new();
    let sid = SID
        .get_or_init(|| current_user_sid().unwrap_or_else(|_| "unknown".to_string()))
        .clone();

    if sid == "unknown" {
        Err(NativeOfficeSecurityError::TokenOpenFailed)
    } else {
        Ok(sid)
    }
}

/// Build the full pipe name for this user session.
/// Returns error if SID cannot be obtained.
pub fn pipe_name() -> Result<String, NativeOfficeSecurityError> {
    let sid = pipe_sid()?;
    Ok(format!(
        "\\\\.\\pipe\\{}.{}",
        super::pipe_protocol::PIPE_PREFIX,
        sid
    ))
}

/// Get pipe leaf name (without \\\\.\\pipe\\ prefix).
/// Used by C# NamedPipeClientStream.
pub fn pipe_leaf_name() -> Result<String, NativeOfficeSecurityError> {
    let sid = pipe_sid()?;
    Ok(format!("{}.{}", super::pipe_protocol::PIPE_PREFIX, sid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipe_name_format() {
        let name = pipe_name().unwrap();
        assert!(name.starts_with("\\\\.\\pipe\\LaTeXSnipper.NativeOffice.v3."));
        // SID should start with S-1-
        assert!(
            name.contains("S-1-"),
            "Pipe name should contain SID, got: {}",
            name
        );
    }

    #[test]
    fn test_pipe_leaf_name() {
        let leaf = pipe_leaf_name().unwrap();
        assert!(leaf.starts_with("LaTeXSnipper.NativeOffice.v3."));
        assert!(!leaf.contains("\\\\.\\pipe\\"));
    }
}
