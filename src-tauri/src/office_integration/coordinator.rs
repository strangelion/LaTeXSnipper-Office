//! Office integration coordinator.
//!
//! The coordinator is responsible for:
//! - Host resolution (which Office app to target)
//! - Session selection
//! - Document context validation
//! - Routing Named Pipe requests to the correct session

#[cfg(target_os = "windows")]
use std::sync::Arc;

#[cfg(target_os = "windows")]
use crate::platforms::session::SessionManager;

use super::dto::{OfficeHost, OfficeTarget};

/// Result of route resolution: which channel was selected and why.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ResolvedRoute {
    pub target: OfficeTarget,
    pub actual_route: super::dto::OfficeRouteMode,
}

/// The unified Office integration coordinator.
#[allow(dead_code)]
pub struct OfficeCoordinator {
    #[cfg(target_os = "windows")]
    session_manager: Arc<SessionManager>,
}

#[allow(dead_code)]
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
                "No {host} session is connected. Open a {host} document first."
            ));
        }

        if matching.len() > 1 && preferred_session_id.is_none() && expected_document_id.is_none() {
            return Err(format!(
                "Multiple {host} sessions are connected ({:?}). \
                 An explicit session or document context is required.",
                matching.iter().map(|s| &s.session_id).collect::<Vec<_>>()
            ));
        }

        let session = if let Some(sid) = preferred_session_id {
            matching
                .iter()
                .find(|s| s.session_id == sid)
                .ok_or_else(|| {
                    format!(
                        "Requested session {sid} is not connected. \
                         Available {host} sessions: {:?}",
                        matching.iter().map(|s| &s.session_id).collect::<Vec<_>>()
                    )
                })?
        } else if let Some(doc_id) = expected_document_id {
            matching
                .iter()
                .find(|s| s.document_id.as_deref() == Some(doc_id))
                .ok_or_else(|| {
                    format!(
                        "No {host} session matches document {doc_id}. \
                         Available sessions: {:?}",
                        matching.iter().map(|s| &s.session_id).collect::<Vec<_>>()
                    )
                })?
        } else {
            matching
                .first()
                .ok_or_else(|| format!("No {host} session is connected"))?
        };

        let document_context = session.document_id.clone().ok_or_else(|| {
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
            "Office integration for {host} is only available on Windows."
        ))
    }

    /// Resolve the integration route: Auto → NativeOffice if session available.
    ///
    /// On Windows with an active VSTO session, returns NativeOffice.
    /// The Office.js fallback is reserved for macOS/Web and will be
    /// added when the Bridge heartbeat check is implemented.
    #[cfg(target_os = "windows")]
    pub async fn resolve_route(&self, host: OfficeHost) -> Result<ResolvedRoute, String> {
        let target = self.resolve_target(host, None, None).await?;
        Ok(ResolvedRoute {
            target,
            actual_route: super::dto::OfficeRouteMode::NativeOffice,
        })
    }

    #[cfg(not(target_os = "windows"))]
    pub async fn resolve_route(&self, host: OfficeHost) -> Result<ResolvedRoute, String> {
        Err(format!(
            "Office integration for {host} requires Windows with Native Office, \
             or macOS/Web with Office.js (not yet implemented)."
        ))
    }
}

#[cfg(not(target_os = "windows"))]
impl Default for OfficeCoordinator {
    fn default() -> Self {
        Self::new()
    }
}
