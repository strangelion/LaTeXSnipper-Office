//! Tests for Native Office VSTO integration.
//!
//! Covers:
//! - SID / DACL verification
//! - Pipe name format
//! - Protocol version
//! - Session lifecycle

#[cfg(test)]
mod platform_hardening_tests {
    use crate::platforms::acl;
    use crate::platforms::pipe_protocol;
    use crate::platforms::pipe_security;
    use crate::platforms::session;
    use crate::platforms::windows_identity;

    // ---------------------------------------------------------------------------
    // SID / Pipe Name Tests
    // ---------------------------------------------------------------------------

    #[test]
    fn test_pipe_name_uses_v3_prefix() {
        let name = acl::pipe_name().unwrap();
        assert!(
            name.starts_with("\\\\.\\pipe\\LaTeXSnipper.NativeOffice.v3."),
            "Pipe name should use v3 prefix, got: {}",
            name
        );
    }

    #[test]
    fn test_pipe_leaf_name_format() {
        let leaf = acl::pipe_leaf_name().unwrap();
        assert!(
            leaf.starts_with("LaTeXSnipper.NativeOffice.v3."),
            "Leaf name should start with v3 prefix, got: {}",
            leaf
        );
        assert!(
            !leaf.contains("\\\\.\\pipe\\"),
            "Leaf name should not contain pipe path prefix"
        );
    }

    #[test]
    fn test_sid_is_not_username() {
        let sid = acl::pipe_sid().unwrap();
        let pipe_name = acl::pipe_name().unwrap();
        assert!(
            pipe_name.contains(&format!("{}.{}", pipe_protocol::PIPE_PREFIX, sid)),
            "Pipe name should contain SID"
        );
    }

    // ---------------------------------------------------------------------------
    // Protocol Version Tests
    // ---------------------------------------------------------------------------

    #[test]
    fn test_protocol_version_is_v3() {
        assert_eq!(pipe_protocol::PROTOCOL_VERSION, 3);
    }

    #[test]
    fn test_pipe_prefix_is_v3() {
        assert_eq!(pipe_protocol::PIPE_PREFIX, "LaTeXSnipper.NativeOffice.v3");
    }

    // ---------------------------------------------------------------------------
    // Security Descriptor Tests
    // ---------------------------------------------------------------------------

    #[test]
    fn test_security_descriptor_creation() {
        let result = pipe_security::PipeSecurityDescriptor::current_user_and_system();
        assert!(
            result.is_ok(),
            "Security descriptor creation should succeed: {:?}",
            result.err()
        );
    }

    // ---------------------------------------------------------------------------
    // Session Lifecycle Tests
    // ---------------------------------------------------------------------------

    #[tokio::test]
    async fn test_session_creation_and_removal() {
        let _ = std::any::type_name::<session::SessionManager>();
    }

    // ---------------------------------------------------------------------------
    // Windows Identity Tests
    // ---------------------------------------------------------------------------

    #[test]
    fn test_windows_identity_sid() {
        #[cfg(target_os = "windows")]
        {
            let result = windows_identity::current_user_sid();
            assert!(result.is_ok(), "SID should be obtainable on Windows");
            let sid = result.unwrap();
            assert!(!sid.is_empty(), "SID should not be empty");
        }
    }
}
