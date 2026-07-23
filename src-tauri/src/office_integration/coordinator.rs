//! Office integration coordinator.
//!
//! The coordinator is responsible for:
//! - Host resolution (which Office app to target)
//! - Session selection
//! - Document context validation
//! - Routing Named Pipe requests to the correct session

use std::sync::Arc;

#[cfg(target_os = "windows")]
use crate::platforms::session::SessionManager;

use super::dto::{OfficeHost, OfficeTarget};

/// The unified Office integration coordinator.
pub struct OfficeCoordinator {
    #[cfg(target_os = "windows")]
    session_manager: Arc<SessionManager>,
}

impl OfficeCoordinator {
    /// Create a new coordinator.
    #[cfg(target_os = "windows")]
    pub fn new(session_manager: Arc<SessionManager>) -> Self {
        Self { session_manager }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn new() -> Self {
        Self {}
    }

    /// Resolve the best session for a given host.
    #[cfg(target_os = "windows")]
    pub async fn resolve_target(
        &self,
        host: OfficeHost,
        preferred_session_id: Option<&str>,
        expected_document_id: Option<&str>,
    ) -> Result<OfficeTarget, String> {
        let sessions = self.session_manager.list_sessions().await;

        // Filter by host type
        let host_type = match host {
            OfficeHost::Word => crate::platforms::session::HostType::Word,
            OfficeHost::Excel => crate::platforms::session::HostType::Excel,
            OfficeHost::PowerPoint => crate::platforms::session::HostType::PowerPoint,
            OfficeHost::Visio => crate::platforms::session::HostType::Visio,
        };

        let matching: Vec<_> = sessions
            .iter()
            .filter(|s| s.host_type == host_type)
            .collect();

        if matching.is_empty() {
            return Err(format!(
                "No {host:?} session is connected. Open a {host:?} document first."
            ));
        }

        // If a session_id is preferred, try to find it
        let session = if let Some(sid) = preferred_session_id {
            matching
                .iter()
                .find(|s| s.session_id == sid)
                .or_else(|| matching.first())
                .ok_or_else(|| format!("Session {sid} not found"))?
        } else {
            matching.first().unwrap()
        };

        // Validate document context if expected
        let document_context = session
            .document_id
            .clone()
            .ok_or_else(|| {
                format!(
                    "Document context is not available for session {}",
                    session.session_id
                )
            })?;

        if let Some(expected) = expected_document_id {
            if document_context != expected {
                return Err(format!(
                    "Document context mismatch: expected {expected}, got {document_context}"
                ));
            }
        }

        Ok(OfficeTarget {
            host,
            session_id: session.session_id.clone(),
            document_context,
        })
    }

    #[cfg(not(target_os = "windows"))]
    pub async fn resolve_target(
        &self,
        host: OfficeHost,
        _preferred_session_id: Option<&str>,
        _expected_document_id: Option<&str>,
    ) -> Result<OfficeTarget, String> {
        Err(format!(
            "Office integration for {host:?} is only available on Windows."
        ))
    }
}
