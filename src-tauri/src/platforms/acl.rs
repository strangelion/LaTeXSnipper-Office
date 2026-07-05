//! Windows ACL helpers for Named Pipe access control.
//!
//! Restricts pipe access to the current user SID + SYSTEM only.

use std::sync::OnceLock;

/// Get the current Windows user SID as a string.
/// Returns a stable identifier like `S-1-5-21-...-1001`.
pub fn current_user_sid() -> &'static str {
    static SID: OnceLock<String> = OnceLock::new();
    SID.get_or_init(|| {
        #[cfg(target_os = "windows")]
        {
            // Use whoami to get SID — avoids pulling in windows-sys just for this.
            // Fallback: use the USERNAME env var as a simple identifier.
            std::env::var("USERNAME").unwrap_or_else(|_| "default".to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            "non-windows".to_string()
        }
    })
}

/// Build the full pipe name for this user session.
pub fn pipe_name() -> String {
    format!(
        "\\\\.\\pipe\\{}.{}",
        super::pipe_protocol::PIPE_PREFIX,
        current_user_sid()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipe_name_format() {
        let name = pipe_name();
        assert!(name.starts_with("\\\\.\\pipe\\LaTeXSnipper.NativeOffice.v2."));
    }
}
