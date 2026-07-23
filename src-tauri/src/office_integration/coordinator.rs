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
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct ResolvedRoute {
    pub target: OfficeTarget,
    pub actual_route: super::dto::OfficeRouteMode,
}

/// The unified Office integration coordinator.
pub struct OfficeCoordinator {
    #[cfg(target_os = "windows")]
    session_manager: Arc<SessionManager>,
    js_registry: super::office_js_registry::OfficeJsSessionRegistry,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl OfficeCoordinator {
    /// Create a new coordinator.
    #[cfg(target_os = "windows")]
    pub fn new(
        session_manager: Arc<SessionManager>,
        js_registry: super::office_js_registry::OfficeJsSessionRegistry,
    ) -> Self {
        Self {
            session_manager,
            js_registry,
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn new(js_registry: super::office_js_registry::OfficeJsSessionRegistry) -> Self {
        Self { js_registry }
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
    /// Auto route: try Native Office first, fall back to Office.js.
    /// Office.js fallback requires the OfficeJsSessionRegistry to be wired
    /// in main.rs and heartbeat from the TaskPane Bridge.
    #[cfg(target_os = "windows")]
    pub async fn resolve_route(
        &self,
        host: OfficeHost,
        preferred_session_id: Option<&str>,
        expected_document_id: Option<&str>,
    ) -> Result<ResolvedRoute, String> {
        // Try Native Office first
        if let Ok(target) = self
            .resolve_target(host.clone(), preferred_session_id, expected_document_id)
            .await
        {
            return Ok(ResolvedRoute {
                target,
                actual_route: super::dto::OfficeRouteMode::NativeOffice,
            });
        }

        // Fall back to Office.js via heartbeat registry
        let host_str = host.to_string().to_lowercase();
        self.js_registry
            .resolve_fresh(&host_str, expected_document_id)
            .await
            .map(|js_session| ResolvedRoute {
                target: OfficeTarget {
                    host: host.clone(),
                    session_id: js_session.client_id,
                    document_context: js_session.document_context,
                },
                actual_route: super::dto::OfficeRouteMode::OfficeJs,
            })
            .map_err(|e| {
                format!(
                    "No Native Office {host_str} session is connected and Office.js \
                     fallback failed: {e}"
                )
            })
    }

    #[cfg(not(target_os = "windows"))]
    pub async fn resolve_route(
        &self,
        host: OfficeHost,
        _preferred_session_id: Option<&str>,
        expected_document_id: Option<&str>,
    ) -> Result<ResolvedRoute, String> {
        let host_str = host.to_string().to_lowercase();
        self.js_registry
            .resolve_fresh(&host_str, expected_document_id)
            .await
            .map(|js_session| ResolvedRoute {
                target: OfficeTarget {
                    host,
                    session_id: js_session.client_id,
                    document_context: js_session.document_context,
                },
                actual_route: super::dto::OfficeRouteMode::OfficeJs,
            })
            .map_err(|e| format!("No Office.js {host_str} client is active: {e}"))
    }
}

#[cfg(not(target_os = "windows"))]
impl Default for OfficeCoordinator {
    fn default() -> Self {
        Self::new()
    }
}
