//! Session management for Native Office VSTO connections.
//!
//! Each VSTO Add-in (Word / Excel / PowerPoint) maintains one session.
//! The SessionManager routes incoming messages to the correct handler
//! and tracks insertion anchors per session.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};

use super::pipe_protocol::*;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostType {
    Word,
    Excel,
    PowerPoint,
}

impl HostType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "word" => Some(Self::Word),
            "excel" => Some(Self::Excel),
            "powerpoint" => Some(Self::PowerPoint),
            _ => None,
        }
    }
}

/// A single VSTO session representing one connected Office Add-in.
#[derive(Debug)]
pub struct OfficeSession {
    pub session_id: String,
    pub host_type: HostType,
    pub host_version: String,
    pub document_id: Option<String>,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    /// Channel to send outgoing messages to this VSTO client.
    pub writer: Option<mpsc::Sender<Vec<u8>>>,
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

pub struct SessionManager {
    sessions: RwLock<HashMap<String, OfficeSession>>,
    app_handle: tauri::AppHandle,
}

impl SessionManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            app_handle,
        }
    }

    /// Process an incoming VSTO message and produce a response.
    /// The `writer` parameter is provided during HELLO handshake to register the channel.
    pub async fn handle_message(
        &self,
        msg: VstoMessage,
        writer: Option<mpsc::Sender<Vec<u8>>>,
    ) -> ResponseEnvelope {
        match msg {
            VstoMessage::Hello {
                requestId,
                sessionId,
                protocolVersion,
                dpapiSecret,
                hostType,
                hostVersion,
                windowHandle: _,
            } => {
                // Verify protocol version
                if protocolVersion != PROTOCOL_VERSION {
                    log::warn!("[Session] HELLO rejected: protocol version mismatch ({} vs {})", protocolVersion, PROTOCOL_VERSION);
                    return ResponseEnvelope {
                        requestId: requestId.clone(),
                        sessionId: sessionId.clone(),
                        response: DesktopMessage::HelloNack {
                            requestId,
                            sessionId,
                            errorCode: "VERSION_MISMATCH".to_string(),
                            error: format!("Protocol version {} not supported, expected {}", protocolVersion, PROTOCOL_VERSION),
                        },
                    };
                }

                // Verify shared secret
                if !super::handshake::verify_secret(&dpapiSecret) {
                    log::warn!("[Session] HELLO rejected: invalid secret");
                    return ResponseEnvelope {
                        requestId: requestId.clone(),
                        sessionId: sessionId.clone(),
                        response: DesktopMessage::HelloNack {
                            requestId,
                            sessionId,
                            errorCode: "INVALID_SECRET".to_string(),
                            error: "Shared secret verification failed".to_string(),
                        },
                    };
                }

                // Register session with writer channel
                let host = HostType::from_str(&hostType).unwrap_or(HostType::Word);
                let session = OfficeSession {
                    session_id: sessionId.clone(),
                    host_type: host,
                    host_version: hostVersion.clone(),
                    document_id: None,
                    connected_at: chrono::Utc::now(),
                    writer,  // Register the writer channel here
                };
                self.sessions.write().await.insert(sessionId.clone(), session);

                log::info!(
                    "[Session] HELLO from {} v{} (session={})",
                    hostType,
                    hostVersion,
                    sessionId
                );

                ResponseEnvelope {
                    requestId: requestId.clone(),
                    sessionId: sessionId.clone(),
                    response: DesktopMessage::HelloAck {
                        requestId,
                        sessionId,
                        protocolVersion: PROTOCOL_VERSION,
                    },
                }
            }

            VstoMessage::HostReady {
                requestId,
                sessionId,
                hostType,
                hostVersion,
                documentId,
            } => {
                if let Some(session) = self.sessions.write().await.get_mut(&sessionId) {
                    session.document_id = documentId;
                    session.host_version = hostVersion;
                    log::info!(
                        "[Session] HOST_READY {} (session={}, doc={:?})",
                        hostType,
                        sessionId,
                        session.document_id
                    );
                }
                ResponseEnvelope {
                    requestId: requestId.clone(),
                    sessionId: sessionId.clone(),
                    response: DesktopMessage::Ping {
                        requestId,
                        sessionId,
                    },
                }
            }

            VstoMessage::ReadSelection {
                requestId,
                sessionId,
                formula,
                rangeXml,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] READ_SELECTION (session={})", sid);

                // Priority: formula.latex > rangeXml OMML conversion
                if let Some(ref f) = formula {
                    if !f.latex.is_empty() {
                        log::info!("[Session] Using FormulaPayload.latex: {}", &f.latex[..f.latex.len().min(50)]);
                        let _ = self.app_handle.emit(
                            "native-office-latex-loaded",
                            serde_json::json!({ "latex": f.latex, "sessionId": sid }),
                        );
                    } else if !f.omml.is_empty() {
                        // Fallback: convert OMML to LaTeX via Core
                        match self.convert_omml_to_latex(&f.omml) {
                            Ok(latex) => {
                                let _ = self.app_handle.emit(
                                    "native-office-latex-loaded",
                                    serde_json::json!({ "latex": latex, "sessionId": sid }),
                                );
                            }
                            Err(e) => {
                                log::warn!("[Session] OMML->LaTeX conversion failed: {}", e);
                            }
                        }
                    }
                } else if let Some(xml) = rangeXml {
                    // Fallback: parse OOXML and extract LaTeX
                    match self.extract_latex_from_ooxml(&xml).await {
                        Ok(latex) => {
                            let _ = self.app_handle.emit(
                                "native-office-latex-loaded",
                                serde_json::json!({ "latex": latex, "sessionId": sid }),
                            );
                        }
                        Err(e) => {
                            log::warn!("[Session] READ_SELECTION parse error: {}", e);
                        }
                    }
                }

                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::ReadTable {
                requestId,
                sessionId,
                table,
                tableXml,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] READ_TABLE (session={})", sid);

                // Priority: table struct > tableXml JSON
                if let Some(ref t) = table {
                    let _ = self.app_handle.emit(
                        "native-office-table-loaded",
                        serde_json::json!({ "table": t, "sessionId": sid }),
                    );
                } else if let Some(xml) = tableXml {
                    // Try to parse as TablePayload JSON
                    if let Ok(payload) = serde_json::from_str::<super::pipe_protocol::TablePayload>(&xml) {
                        let _ = self.app_handle.emit(
                            "native-office-table-loaded",
                            serde_json::json!({ "table": payload, "sessionId": sid }),
                        );
                    } else {
                        // Raw XML fallback
                        let _ = self.app_handle.emit(
                            "native-office-table-loaded",
                            serde_json::json!({ "xml": xml, "sessionId": sid }),
                        );
                    }
                }
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::InsertResult {
                requestId,
                sessionId,
                success,
                formulaId,
                error,
                ..
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!(
                    "[Session] INSERT_RESULT success={} formulaId={:?} error={:?}",
                    success,
                    formulaId,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-insert-result",
                    serde_json::json!({
                        "success": success,
                        "formulaId": formulaId,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::ReplaceResult {
                requestId,
                sessionId,
                success,
                error,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!(
                    "[Session] REPLACE_RESULT success={} error={:?}",
                    success,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-replace-result",
                    serde_json::json!({
                        "success": success,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::DeleteResult {
                requestId,
                sessionId,
                success,
                error,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!(
                    "[Session] DELETE_RESULT success={} error={:?}",
                    success,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-delete-result",
                    serde_json::json!({
                        "success": success,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::HostError {
                requestId,
                sessionId,
                error,
                errorCode,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::error!(
                    "[Session] HOST_ERROR code={:?} error={}",
                    errorCode,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-error",
                    serde_json::json!({
                        "error": error,
                        "errorCode": errorCode,
                        "sessionId": sid,
                    }),
                );
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }

            VstoMessage::OpenEditor {
                requestId,
                sessionId,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] OPEN_EDITOR (session={})", sid);
                let _ = self.app_handle.emit(
                    "native-office-open-editor",
                    serde_json::json!({ "sessionId": sid }),
                );
                ResponseEnvelope {
                    requestId: rid.clone(),
                    sessionId: sid.clone(),
                    response: DesktopMessage::Ping {
                        requestId: rid,
                        sessionId: sid,
                    },
                }
            }
        }
    }

    /// Send a command to a specific session.
    pub async fn send_to_session(
        &self,
        session_id: &str,
        msg: DesktopMessage,
    ) -> Result<(), SendError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or(SendError::SessionNotFound)?;

        if let Some(writer) = &session.writer {
            let frame = encode_frame(&msg);
            writer
                .send(frame)
                .await
                .map_err(|_| SendError::ChannelClosed)?;
            Ok(())
        } else {
            Err(SendError::NoWriter)
        }
    }

    /// Get a list of all connected sessions.
    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .map(|s| SessionInfo {
                session_id: s.session_id.clone(),
                host_type: s.host_type,
                host_version: s.host_version.clone(),
                document_id: s.document_id.clone(),
                connected_at: s.connected_at,
            })
            .collect()
    }

    /// Remove a disconnected session.
    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.write().await.remove(session_id);
        log::info!("[Session] Removed session {}", session_id);
    }

    /// Extract LaTeX text from Word OOXML (simplified parser).
    async fn extract_latex_from_ooxml(&self, xml: &str) -> Result<String, String> {
        // Look for LaTeX in ContentControl tags: latexsnipper:formula:{uuid}
        // or extract from <w:t> elements inside m:oMath
        if xml.contains("<m:oMath") || xml.contains("<m:oMathPara") {
            // OMML detected — send to Core for conversion
            let _ = self.app_handle.emit(
                "native-office-omml-detected",
                serde_json::json!({ "omml": xml }),
            );
            return Ok(String::new());
        }

        // Extract plain text from <w:t> elements
        let mut texts = Vec::new();
        let mut in_text = false;
        for line in xml.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("<w:t") {
                in_text = true;
            }
            if in_text {
                // Extract content between tags
                if let Some(start) = trimmed.find('>') {
                    if let Some(end) = trimmed[start..].find("</w:t") {
                        let content = &trimmed[start + 1..start + end];
                        texts.push(content.to_string());
                        in_text = false;
                    }
                }
            }
        }
        Ok(texts.join(""))
    }

    /// Convert OMML to LaTeX using Core conversion.
    fn convert_omml_to_latex(&self, omml: &str) -> Result<String, String> {
        crate::math::omml_to_latex(omml.to_string())
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct ResponseEnvelope {
    pub requestId: String,
    pub sessionId: String,
    pub response: DesktopMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub host_type: HostType,
    pub host_version: String,
    pub document_id: Option<String>,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub enum SendError {
    SessionNotFound,
    ChannelClosed,
    NoWriter,
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionNotFound => write!(f, "session not found"),
            Self::ChannelClosed => write!(f, "channel closed"),
            Self::NoWriter => write!(f, "no writer available"),
        }
    }
}

impl std::error::Error for SendError {}
