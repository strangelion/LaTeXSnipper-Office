//! Session management for Native Office VSTO connections.
//!
//! Each VSTO Add-in (Word / Excel / PowerPoint / Visio) maintains one session.
//! The SessionManager routes incoming messages to the correct handler
//! and tracks insertion anchors per session.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
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
    Visio,
}

impl HostType {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "word" => Some(Self::Word),
            "excel" => Some(Self::Excel),
            "powerpoint" => Some(Self::PowerPoint),
            "visio" => Some(Self::Visio),
            _ => None,
        }
    }

    /// Default capabilities for a host type.
    /// Used before HOST_READY reports real capabilities via the pipe protocol.
    pub fn default_capabilities(&self) -> Vec<String> {
        match self {
            Self::Word => vec![
                "insert_formula",
                "replace_formula",
                "read_selection",
                "insert_table",
                "read_table",
            ],
            Self::Excel | Self::PowerPoint | Self::Visio => {
                vec!["insert_formula", "replace_formula", "read_selection"]
            }
        }
        .into_iter()
        .map(String::from)
        .collect()
    }
}

/// A single VSTO session representing one connected Office Add-in.
#[derive(Debug)]
pub struct OfficeSession {
    pub session_id: String,
    /// Monotonically increasing counter identifying this particular connection.
    /// Used to prevent a stale old connection from removing a newer one.
    pub connection_id: u64,
    pub host_type: HostType,
    pub host_version: String,
    pub document_id: Option<String>,
    pub document_title: Option<String>,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    /// Channel to send outgoing messages to this VSTO client.
    pub writer: Option<mpsc::Sender<Vec<u8>>>,
    /// Capabilities reported by the VSTO add-in during HOST_READY.
    pub capabilities: Vec<String>,
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

pub struct SessionManager {
    sessions: RwLock<HashMap<String, OfficeSession>>,
    app_handle: tauri::AppHandle,
    /// Monotonically increasing connection counter.
    connection_counter: std::sync::atomic::AtomicU64,
}

/// Result of processing a message: the response plus the connection_id if a new session was registered.
pub struct HandleMessageResult {
    pub response: ResponseEnvelope,
    pub connection_id: Option<u64>,
}

impl SessionManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            app_handle,
            connection_counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Process an incoming VSTO message and produce a response.
    /// The `writer` parameter is provided during HELLO handshake to register the channel.
    /// Returns both the response and the connection_id (if a session was registered) to avoid TOCTOU races.
    pub async fn handle_message(
        &self,
        msg: VstoMessage,
        writer: Option<mpsc::Sender<Vec<u8>>>,
    ) -> HandleMessageResult {
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
                    log::warn!(
                        "[Session] HELLO rejected: protocol version mismatch ({} vs {})",
                        protocolVersion,
                        PROTOCOL_VERSION
                    );
                    return HandleMessageResult {
                        response: ResponseEnvelope {
                            requestId: requestId.clone(),
                            sessionId: sessionId.clone(),
                            response: DesktopMessage::HelloNack {
                                requestId,
                                sessionId,
                                errorCode: "VERSION_MISMATCH".to_string(),
                                error: format!(
                                    "Protocol version {} not supported, expected {}",
                                    protocolVersion, PROTOCOL_VERSION
                                ),
                            },
                        },
                        connection_id: None,
                    };
                }

                // Verify shared secret
                if !super::handshake::verify_secret(&dpapiSecret) {
                    log::warn!("[Session] HELLO rejected: invalid secret");
                    return HandleMessageResult {
                        response: ResponseEnvelope {
                            requestId: requestId.clone(),
                            sessionId: sessionId.clone(),
                            response: DesktopMessage::HelloNack {
                                requestId,
                                sessionId,
                                errorCode: "INVALID_SECRET".to_string(),
                                error: "Shared secret verification failed".to_string(),
                            },
                        },
                        connection_id: None,
                    };
                }

                // Register session with writer channel
                let host = HostType::parse(&hostType).unwrap_or(HostType::Word);
                let connection_id = self
                    .connection_counter
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let session = OfficeSession {
                    session_id: sessionId.clone(),
                    connection_id,
                    host_type: host,
                    host_version: hostVersion.clone(),
                    document_id: None,
                    document_title: None,
                    connected_at: chrono::Utc::now(),
                    writer, // Register the writer channel here
                    capabilities: host.default_capabilities(),
                };
                self.sessions
                    .write()
                    .await
                    .insert(sessionId.clone(), session);

                let _ = self.app_handle.emit(
                    "native-office-session-added",
                    serde_json::json!({
                        "sessionId": sessionId,
                    }),
                );

                log::info!(
                    "[Session] HELLO from {} v{} (session={}, connection_id={})",
                    hostType,
                    hostVersion,
                    sessionId,
                    connection_id
                );

                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: requestId.clone(),
                        sessionId: sessionId.clone(),
                        response: DesktopMessage::HelloAck {
                            requestId,
                            sessionId,
                            protocolVersion: PROTOCOL_VERSION,
                        },
                    },
                    connection_id: Some(connection_id),
                }
            }

            VstoMessage::HostReady {
                requestId,
                sessionId,
                hostType,
                hostVersion,
                hostPid: _,
                documentContextId,
                documentTitle,
                documentKind: _,
                capabilities,
            } => {
                if let Some(session) = self.sessions.write().await.get_mut(&sessionId) {
                    session.document_id = documentContextId;
                    session.document_title = documentTitle.clone();
                    session.host_version = hostVersion;
                    // Store capabilities as a list of supported feature strings
                    if let Some(ref caps) = capabilities {
                        let mut cap_list = Vec::new();
                        if caps.insert_formula {
                            cap_list.push("insert_formula".to_string());
                        }
                        if caps.replace_formula {
                            cap_list.push("replace_formula".to_string());
                        }
                        if caps.read_selection {
                            cap_list.push("read_selection".to_string());
                        }
                        if caps.insert_table {
                            cap_list.push("insert_table".to_string());
                        }
                        if caps.read_table {
                            cap_list.push("read_table".to_string());
                        }
                        cap_list.extend(
                            caps.features
                                .iter()
                                .filter(|(_, enabled)| **enabled)
                                .map(|(name, _)| name.clone()),
                        );
                        session.capabilities = cap_list;
                    }
                    log::info!(
                        "[Session] HOST_READY {} (session={}, doc={:?}, title={:?})",
                        hostType,
                        sessionId,
                        session.document_id,
                        documentTitle
                    );
                    let _ = self.app_handle.emit(
                        "native-office-session-updated",
                        serde_json::json!({
                            "sessionId": sessionId,
                        }),
                    );
                }
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: requestId.clone(),
                        sessionId: sessionId.clone(),
                        response: DesktopMessage::Ping {
                            requestId,
                            sessionId,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::VstoContextChanged {
                requestId,
                sessionId,
                documentContextId,
                documentTitle,
                documentKind: _,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                let ctx_id = documentContextId.clone();
                let title = documentTitle.clone();

                if let Some(session) = self.sessions.write().await.get_mut(&sid) {
                    session.document_id = Some(ctx_id.clone());
                    if title.is_some() {
                        session.document_title = title.clone();
                    }
                    log::info!(
                        "[Session] CONTEXT_CHANGED (session={}, title={:?})",
                        sid,
                        title
                    );
                }
                let _ = self.app_handle.emit(
                    "native-office-context-changed",
                    serde_json::json!({
                        "sessionId": sid,
                        "documentContextId": ctx_id,
                        "documentTitle": title,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
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
                let document_context_id = self
                    .sessions
                    .read()
                    .await
                    .get(&sid)
                    .and_then(|session| session.document_id.clone());

                // Preserve the complete formula payload so callers retain its identity,
                // revision, storage mode, render metadata, and source metadata.
                if let Some(mut formula) = formula {
                    if !formula.latex.is_empty() {
                        log::info!(
                            "[Session] Using FormulaPayload.latex: {}",
                            formula.latex.chars().take(50).collect::<String>()
                        );
                    } else if !formula.omml.is_empty() {
                        match self.convert_omml_to_latex(&formula.omml) {
                            Ok(latex) => {
                                formula.latex = latex;
                            }
                            Err(e) => {
                                log::warn!("[Session] OMML->LaTeX conversion failed: {}", e);
                            }
                        }
                    }

                    let _ = self.app_handle.emit(
                        "native-office-formula-loaded",
                        serde_json::json!({
                            "formula": formula,
                            "sessionId": sid,
                            "documentContextId": document_context_id,
                        }),
                    );
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

                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::FormulaSnapshot {
                requestId,
                sessionId,
                formula,
                errorCode,
                error,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                let document_context_id = self
                    .sessions
                    .read()
                    .await
                    .get(&sid)
                    .and_then(|session| session.document_id.clone());
                let _ = self.app_handle.emit(
                    "native-office-formula-snapshot",
                    serde_json::json!({
                        "requestId": requestId,
                        "sessionId": sid,
                        "documentContextId": document_context_id,
                        "formula": formula,
                        "errorCode": errorCode,
                        "error": error,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
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
                    if let Ok(payload) =
                        serde_json::from_str::<super::pipe_protocol::TablePayload>(&xml)
                    {
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
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::InsertResult {
                requestId,
                sessionId,
                success,
                formulaId,
                requestedStorageMode,
                actualStorageMode,
                fallbackReason,
                errorCode,
                error,
                ..
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!(
                    "[Session] INSERT_RESULT success={} formulaId={:?} requested={:?} actual={:?} errorCode={:?} fallback={:?} error={:?}",
                    success,
                    formulaId,
                    requestedStorageMode,
                    actualStorageMode,
                    errorCode,
                    fallbackReason,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-insert-result",
                    serde_json::json!({
                        "success": success,
                        "formulaId": formulaId,
                        "requestedStorageMode": requestedStorageMode,
                        "actualStorageMode": actualStorageMode,
                        "fallbackReason": fallbackReason,
                        "errorCode": errorCode,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::ConversationImportResult {
                requestId,
                sessionId,
                importId,
                success,
                errorCode,
                error,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                let _ = self.app_handle.emit(
                    "native-word-conversation-import-result",
                    serde_json::json!({
                        "importId": importId,
                        "success": success,
                        "errorCode": errorCode,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::InsertTableResult {
                requestId,
                sessionId,
                success,
                tableId,
                error,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!(
                    "[Session] INSERT_TABLE_RESULT success={} tableId={:?} error={:?}",
                    success,
                    tableId,
                    error
                );
                let _ = self.app_handle.emit(
                    "native-office-insert-table-result",
                    serde_json::json!({
                        "success": success,
                        "tableId": tableId,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::ReplaceResult {
                requestId,
                sessionId,
                success,
                formulaId,
                revision,
                actualStorageMode,
                errorCode,
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
                        "requestId": requestId,
                        "success": success,
                        "formulaId": formulaId,
                        "revision": revision,
                        "actualStorageMode": actualStorageMode,
                        "errorCode": errorCode,
                        "error": error,
                        "sessionId": sid,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
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
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
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
                log::error!("[Session] HOST_ERROR code={:?} error={}", errorCode, error);
                let _ = self.app_handle.emit(
                    "native-office-error",
                    serde_json::json!({
                        "error": error,
                        "errorCode": errorCode,
                        "sessionId": sid,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::OpenEditor {
                requestId,
                sessionId,
                action,
                display,
                omml,
                latex,
                formulaId,
                revision,
                sourceHost,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] OPEN_EDITOR (session={}) action={}", sid, action);
                let session_context = self.sessions.read().await.get(&sid).map(|session| {
                    (
                        session.host_type,
                        session.document_id.clone(),
                        session.document_title.clone(),
                    )
                });
                let host = match sourceHost.as_deref().or_else(|| {
                    session_context.as_ref().map(|context| match context.0 {
                        HostType::Word => "word",
                        HostType::Excel => "excel",
                        HostType::PowerPoint => "powerpoint",
                        HostType::Visio => "visio",
                    })
                }) {
                    Some("excel") => super::office_transactions::OfficeHostKind::Excel,
                    Some("powerpoint") => super::office_transactions::OfficeHostKind::PowerPoint,
                    Some("visio") => super::office_transactions::OfficeHostKind::Visio,
                    _ => super::office_transactions::OfficeHostKind::Word,
                };
                let transaction =
                    if matches!(action.as_str(), "insert" | "edit") {
                        let requested_mode =
                            super::office_transactions::FormulaInsertMode::from_protocol(
                                display.as_deref(),
                            );
                        let numbering = (requested_mode
                            == super::office_transactions::FormulaInsertMode::Numbered)
                            .then_some(super::office_transactions::EquationNumberingOptions {
                                scheme: super::office_transactions::EquationNumberingScheme::Global,
                                chapter_level: None,
                                separator: None,
                                label: None,
                            });
                        let transaction_store = self
                            .app_handle
                            .state::<Arc<super::office_transactions::OfficeEditTransactionStore>>();
                        match transaction_store
                        .begin(super::office_transactions::BeginOfficeEditTransactionRequest {
                            integration:
                                super::office_transactions::OfficeIntegrationKind::NativeOffice,
                            host,
                            source_session_id: Some(sid.clone()),
                            source_document_id: session_context
                                .as_ref()
                                .and_then(|context| context.1.clone()),
                            source_object_id: formulaId.clone(),
                            formula_id: formulaId.clone(),
                            action: if action == "edit" {
                                super::office_transactions::OfficeEditAction::Update
                            } else {
                                super::office_transactions::OfficeEditAction::Insert
                            },
                            requested_mode,
                            numbering,
                            original_revision: revision,
                            original_metadata: None,
                            draft_latex: latex.clone().unwrap_or_default(),
                        })
                        .await
                    {
                        Ok(transaction) => Some(transaction),
                        Err(error) => {
                            log::error!(
                                "[OfficeTransaction] OPEN_EDITOR rejected session={} error={}",
                                sid,
                                error
                            );
                            let error_code = if error.contains("OFFICE_TRANSACTION_CONFLICT") {
                                "OFFICE_TRANSACTION_CONFLICT"
                            } else {
                                "OFFICE_TRANSACTION_BEGIN_FAILED"
                            };
                            let _ = self.app_handle.emit(
                                "native-office-error",
                                serde_json::json!({
                                    "error": error,
                                    "errorCode": error_code,
                                    "sessionId": sid,
                                }),
                            );
                            None
                        }
                    }
                    } else {
                        None
                    };
                if matches!(action.as_str(), "insert" | "edit") && transaction.is_none() {
                    return HandleMessageResult {
                        response: ResponseEnvelope {
                            requestId: rid.clone(),
                            sessionId: sid.clone(),
                            response: DesktopMessage::Ping {
                                requestId: rid,
                                sessionId: sid,
                            },
                        },
                        connection_id: None,
                    };
                }
                let _ = self.app_handle.emit(
                    "native-office-open-editor",
                    serde_json::json!({
                        "sessionId": sid,
                        "action": action,
                        "display": display,
                        "omml": omml,
                        "latex": latex,
                        "formulaId": formulaId,
                        "revision": revision,
                        "sourceHost": sourceHost,
                        "transaction": transaction,
                    }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::FocusOcr {
                requestId,
                sessionId,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] FOCUS_OCR (session={})", sid);
                let _ = self.app_handle.emit(
                    "native-office-focus-ocr",
                    serde_json::json!({ "sessionId": sid }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
                }
            }

            VstoMessage::FocusSettings {
                requestId,
                sessionId,
            } => {
                let rid = requestId.clone();
                let sid = sessionId.clone();
                log::info!("[Session] FOCUS_SETTINGS (session={})", sid);
                let _ = self.app_handle.emit(
                    "native-office-focus-settings",
                    serde_json::json!({ "sessionId": sid }),
                );
                HandleMessageResult {
                    response: ResponseEnvelope {
                        requestId: rid.clone(),
                        sessionId: sid.clone(),
                        response: DesktopMessage::Ping {
                            requestId: rid,
                            sessionId: sid,
                        },
                    },
                    connection_id: None,
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
        let session = sessions.get(session_id).ok_or(SendError::SessionNotFound)?;

        log::info!("[Session] send_to_session: found session {}", session_id);

        if let Some(writer) = &session.writer {
            let frame = encode_frame(&msg);
            log::info!("[Session] Sending {} byte frame to channel", frame.len());
            writer
                .send(frame)
                .await
                .map_err(|_| SendError::ChannelClosed)?;
            log::info!("[Session] Frame sent to channel");
            Ok(())
        } else {
            log::warn!("[Session] No writer for session {}", session_id);
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
                document_title: s.document_title.clone(),
                connected_at: s.connected_at,
                capabilities: s.capabilities.clone(),
            })
            .collect()
    }

    /// Remove a disconnected session.
    #[allow(dead_code)]
    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.write().await.remove(session_id);
        let _ = self.app_handle.emit(
            "native-office-session-removed",
            serde_json::json!({
                "sessionId": session_id,
            }),
        );
        log::info!("[Session] Removed session {}", session_id);
    }

    /// Remove a session only if it belongs to the specified connection.
    /// This prevents a stale old connection from removing a newer one.
    pub async fn remove_session_if_current(&self, session_id: &str, connection_id: u64) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get(session_id) {
            if session.connection_id == connection_id {
                sessions.remove(session_id);
                let _ = self.app_handle.emit(
                    "native-office-session-removed",
                    serde_json::json!({
                        "sessionId": session_id,
                    }),
                );
                log::info!(
                    "[Session] Removed session {} (connection_id={})",
                    session_id,
                    connection_id
                );
            } else {
                log::info!(
                    "[Session] Skipped stale cleanup for {} (connection_id={} != current={})",
                    session_id,
                    connection_id,
                    sessions
                        .get(session_id)
                        .map(|s| s.connection_id)
                        .unwrap_or(0)
                );
            }
        }
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

#[derive(Debug, Serialize)]
#[allow(
    non_snake_case,
    dead_code,
    reason = "Envelope field names mirror the versioned desktop protocol"
)]
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
    pub document_title: Option<String>,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    pub capabilities: Vec<String>,
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
