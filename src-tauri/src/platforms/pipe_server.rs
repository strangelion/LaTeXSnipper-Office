//! Named Pipe server for LaTeXSnipper Native Office v3.
//!
//! Listens on `\\.\pipe\LaTeXSnipper.NativeOffice.v3.<SID>` and handles
//! bidirectional communication with VSTO Add-ins.
//!
//! Architecture:
//! - Reader task: reads VstoMessage from pipe -> SessionManager
//! - Writer task: reads DesktopMessage from mpsc channel -> writes to pipe
//! - SessionManager stores Sender for each connected session
//! - DACL: only current user SID + SYSTEM can connect
//! - Authentication: HELLO with valid DPAPI secret required before any other message

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

use super::acl;
use super::pipe_protocol::*;
use super::pipe_security::PipeSecurityDescriptor;
use super::session::SessionManager;

/// Maximum frame size (1 MB) to prevent abuse.
const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// Channel buffer size for outgoing messages.
const CHANNEL_BUFFER: usize = 64;

/// Start the Named Pipe server. Runs forever, accepting connections.
pub async fn start_pipe_server(
    _app_handle: tauri::AppHandle,
    session_manager: Arc<SessionManager>,
) {
    let pipe_name = match acl::pipe_name() {
        Ok(name) => name,
        Err(e) => {
            log::error!(
                "[Pipe] Failed to get pipe name (SID error): {}. Cannot start server.",
                e
            );
            return;
        }
    };
    log::info!("[Pipe] Starting server on {}", pipe_name);

    let mut first = true;

    loop {
        let result = if first {
            create_pipe_instance_first(&pipe_name).await
        } else {
            create_pipe_instance_additional(&pipe_name).await
        };

        first = false;

        match result {
            Ok(server) => {
                let mgr = session_manager.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(server, mgr).await {
                        log::error!("[Pipe] Client handler error: {}", e);
                    }
                });
            }
            Err(e) => {
                log::error!(
                    "[Pipe] Failed to create pipe instance: {}. Retrying in 1s...",
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        }
    }
}

/// Create the first pipe instance (creates the named pipe object).
async fn create_pipe_instance_first(pipe_name: &str) -> Result<NamedPipeServer, std::io::Error> {
    let mut security = PipeSecurityDescriptor::current_user_and_system()
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let server = unsafe {
        ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(pipe_name, security.as_raw_security_attributes())?
    };

    // Wait for client connection
    server.connect().await?;
    log::info!("[Pipe] Client connected (first instance)");
    Ok(server)
}

/// Create an additional pipe instance for the next client.
async fn create_pipe_instance_additional(
    pipe_name: &str,
) -> Result<NamedPipeServer, std::io::Error> {
    let mut security = PipeSecurityDescriptor::current_user_and_system()
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let server = unsafe {
        ServerOptions::new()
            .first_pipe_instance(false)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(pipe_name, security.as_raw_security_attributes())?
    };

    // Wait for client connection
    server.connect().await?;
    log::info!("[Pipe] Client connected (additional instance)");
    Ok(server)
}

/// Handle a single connected client with full duplex communication.
///
/// Authentication gate: only HELLO allowed before auth.
/// After auth, all other messages are accepted.
async fn handle_client(
    mut pipe: NamedPipeServer,
    session_mgr: Arc<SessionManager>,
) -> Result<(), String> {
    // Create channel for outgoing messages (Desktop -> VSTO)
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(CHANNEL_BUFFER);

    // Track authenticated session ID and its connection generation
    let mut authenticated_session_id: Option<String> = None;
    let mut authenticated_connection_id: Option<u64> = None;

    let mut read_buf = vec![0u8; 64 * 1024];
    let mut accum_buf = Vec::new();

    let result = async {
        loop {
            // Check if there are messages to send (non-blocking)
            while let Ok(frame) = rx.try_recv() {
                log::info!("[Pipe] Writing {} bytes to pipe", frame.len());
                if let Err(e) = pipe.write_all(&frame).await {
                    log::error!("[Pipe] Write error: {}", e);
                    return Err(format!("Write error: {}", e));
                }
                log::info!("[Pipe] Write complete");
            }

            // Try to read from pipe (with timeout to allow checking channel)
            match tokio::time::timeout(
                std::time::Duration::from_millis(100),
                pipe.read(&mut read_buf),
            )
            .await
            {
                Ok(Ok(0)) => {
                    log::info!("[Pipe] Client disconnected");
                    return Ok(());
                }
                Ok(Ok(n)) => {
                    accum_buf.extend_from_slice(&read_buf[..n]);

                    // Process complete frames
                    loop {
                        match decode_vsto_frame(&accum_buf) {
                            Ok((msg, consumed)) => {
                                accum_buf.drain(..consumed);

                                // Authentication gate: only HELLO allowed before auth
                                let is_hello = matches!(msg, VstoMessage::Hello { .. });
                                if authenticated_session_id.is_none() && !is_hello {
                                    log::warn!("[Pipe] Unauthenticated message rejected");
                                    return Err("unauthenticated pipe message".to_string());
                                }

                                // Prevent double HELLO
                                if is_hello && authenticated_session_id.is_some() {
                                    log::warn!("[Pipe] Duplicate HELLO rejected");
                                    return Err("duplicate HELLO after authentication".to_string());
                                }

                                // Dispatch to session manager
                                let result =
                                    session_mgr.handle_message(msg, Some(tx.clone())).await;

                                // Track authenticated session — connection_id comes directly from registration
                                if let DesktopMessage::HelloAck { ref sessionId, .. } =
                                    result.response.response
                                {
                                    authenticated_session_id = Some(sessionId.clone());
                                    authenticated_connection_id = result.connection_id;
                                    log::info!(
                                        "[Pipe] Session authenticated: {} (connection_id={:?})",
                                        sessionId,
                                        authenticated_connection_id
                                    );
                                }

                                // If HELLO_NACK, disconnect immediately
                                if let DesktopMessage::HelloNack { ref error, .. } =
                                    result.response.response
                                {
                                    log::warn!("[Pipe] HELLO_NACK: {}. Disconnecting.", error);
                                    let frame = encode_frame(&result.response.response);
                                    let _ = pipe.write_all(&frame).await;
                                    return Err(format!("HELLO_NACK: {}", error));
                                }

                                // Send the inner DesktopMessage directly.
                                // C# expects { "type": "HELLO_ACK", ... } at the wire
                                // level, NOT a nested ResponseEnvelope wrapper.
                                let frame = encode_frame(&result.response.response);
                                if let Err(e) = pipe.write_all(&frame).await {
                                    log::error!("[Pipe] Write error: {}", e);
                                    return Err(format!("Write error: {}", e));
                                }
                            }
                            Err(ProtocolError::InsufficientData) => {
                                // Need more data
                                break;
                            }
                            Err(ProtocolError::JsonParse(e)) => {
                                log::error!("[Pipe] Protocol error: {}. Disconnecting client.", e);
                                return Err(format!("protocol error: {}", e));
                            }
                            Err(ProtocolError::Io(e)) => {
                                return Err(format!("IO error: {}", e));
                            }
                        }
                    }

                    // Guard against oversized frames
                    if accum_buf.len() > MAX_FRAME_SIZE {
                        log::error!(
                            "[Pipe] Frame too large ({} bytes). Disconnecting.",
                            accum_buf.len()
                        );
                        return Err("frame too large".to_string());
                    }
                }
                Ok(Err(e)) => {
                    log::error!("[Pipe] Read error: {}", e);
                    return Err(format!("Read error: {}", e));
                }
                Err(_) => {
                    // Timeout - continue loop to check channel
                    continue;
                }
            }
        }
    }
    .await;

    // Clean up session on disconnect — only if this connection is still the current one
    if let (Some(session_id), Some(connection_id)) =
        (&authenticated_session_id, authenticated_connection_id)
    {
        session_mgr
            .remove_session_if_current(session_id, connection_id)
            .await;
    }

    result
}

/// Send a command to a connected VSTO session.
pub async fn send_insert_formula(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    formula: FormulaPayload,
    mode: InsertMode,
    integration_mode: Option<FormulaIntegrationMode>,
) -> Result<String, super::session::SendError> {
    let request_id = format!("cmd-{}", uuid_simple());
    let msg = DesktopMessage::InsertFormula {
        requestId: request_id.clone(),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        formula,
        mode,
        integration_mode,
    };
    session_mgr.send_to_session(session_id, msg).await?;
    Ok(request_id)
}

/// Send insert formula with a caller-provided requestId.
/// Use this when the caller needs to register a waiter BEFORE sending.
pub async fn send_insert_formula_with_id(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    request_id: String,
    formula: FormulaPayload,
    mode: InsertMode,
    integration_mode: Option<FormulaIntegrationMode>,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::InsertFormula {
        requestId: request_id.clone(),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        formula,
        mode,
        integration_mode,
    };
    session_mgr.send_to_session(session_id, msg).await
}

#[allow(dead_code, reason = "Retained for backward compatibility")]
pub async fn send_replace_formula(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    expected_context_id: Option<String>,
    formula_id: String,
    formula: FormulaPayload,
) -> Result<String, super::session::SendError> {
    let request_id = format!("cmd-{}", uuid_simple());
    let msg = DesktopMessage::ReplaceFormula {
        requestId: request_id.clone(),
        sessionId: session_id.to_string(),
        expectedContextId: expected_context_id,
        formulaId: formula_id,
        formula,
    };
    session_mgr.send_to_session(session_id, msg).await?;
    Ok(request_id)
}

/// Send replace formula with a caller-provided requestId.
/// Use this when the caller needs to register a waiter BEFORE sending.
pub async fn send_replace_formula_with_id(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    request_id: String,
    expected_context_id: Option<String>,
    formula_id: String,
    formula: FormulaPayload,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::ReplaceFormula {
        requestId: request_id,
        sessionId: session_id.to_string(),
        expectedContextId: expected_context_id,
        formulaId: formula_id,
        formula,
    };
    session_mgr.send_to_session(session_id, msg).await
}

#[allow(
    dead_code,
    reason = "Retained for backward compatibility with callers that don't pre-generate requestId"
)]
pub async fn send_read_formula(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    expected_context_id: Option<String>,
    formula_id: String,
) -> Result<String, super::session::SendError> {
    let request_id = format!("cmd-{}", uuid_simple());
    let msg = DesktopMessage::RequestReadFormula {
        requestId: request_id.clone(),
        sessionId: session_id.to_string(),
        expectedContextId: expected_context_id,
        formulaId: formula_id,
    };
    session_mgr.send_to_session(session_id, msg).await?;
    Ok(request_id)
}

/// Send read formula with a caller-provided requestId.
/// Use this when the caller needs to register a waiter BEFORE sending.
pub async fn send_read_formula_with_id(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    request_id: String,
    expected_context_id: Option<String>,
    formula_id: String,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::RequestReadFormula {
        requestId: request_id,
        sessionId: session_id.to_string(),
        expectedContextId: expected_context_id,
        formulaId: formula_id,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_insert_table(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    table: TablePayload,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::InsertTable {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        table,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_delete_current(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    formula_id: Option<String>,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::DeleteCurrent {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        formulaId: formula_id,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_format_selection(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    options: FormatOptions,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::FormatSelection {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        options,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_format_all(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    options: FormatOptions,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::FormatAll {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        options,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_renumber_word(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    start_from: Option<u32>,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::RenumberWord {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        startFrom: start_from,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_insert_word_reference(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    formula_id: String,
    reference_type: String,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::InsertWordReference {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        expectedContextId: None,
        formulaId: formula_id,
        referenceType: reference_type,
    };
    session_mgr.send_to_session(session_id, msg).await
}

/// Generate a simple unique ID (no UUID crate dependency).
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
