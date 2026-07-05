//! Named Pipe server for LaTeXSnipper Native Office v2.
//!
//! Listens on `\\.\pipe\LaTeXSnipper.NativeOffice.v2.<UserSid>` and handles
//! bidirectional communication with VSTO Add-ins.
//!
//! Architecture:
//! - Reader task: reads VstoMessage from pipe -> SessionManager
//! - Writer task: reads DesktopMessage from mpsc channel -> writes to pipe
//! - SessionManager stores Sender for each connected session

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

use super::acl;
use super::pipe_protocol::*;
use super::session::SessionManager;

/// Maximum frame size (1 MB) to prevent abuse.
const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// Channel buffer size for outgoing messages.
const CHANNEL_BUFFER: usize = 64;

/// Start the Named Pipe server. Runs forever, accepting connections.
pub async fn start_pipe_server(app_handle: tauri::AppHandle, session_manager: Arc<SessionManager>) {
    let pipe_name = acl::pipe_name();
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
async fn create_pipe_instance_first(
    pipe_name: &str,
) -> Result<NamedPipeServer, std::io::Error> {
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name)?;

    server.connect().await?;
    log::info!("[Pipe] Client connected (first instance)");
    Ok(server)
}

/// Create an additional pipe instance for the next client.
async fn create_pipe_instance_additional(
    pipe_name: &str,
) -> Result<NamedPipeServer, std::io::Error> {
    let server = ServerOptions::new()
        .first_pipe_instance(false)
        .create(pipe_name)?;

    server.connect().await?;
    log::info!("[Pipe] Client connected (additional instance)");
    Ok(server)
}

/// Handle a single connected client with full duplex communication.
///
/// Architecture:
/// - Creates mpsc channel for outgoing messages
/// - Registers sender in SessionManager
/// - Spawns writer task: reads from receiver, writes to pipe
/// - Runs reader loop: reads from pipe, dispatches to SessionManager
async fn handle_client(
    mut pipe: NamedPipeServer,
    session_mgr: Arc<SessionManager>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Create channel for outgoing messages (Desktop -> VSTO)
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(CHANNEL_BUFFER);

    // Clone pipe handle for writer task
    // Note: NamedPipeServer doesn't implement Clone, so we use a different approach
    // We'll use a shared Arc<Mutex> for the write half

    // For simplicity, we'll use a split approach:
    // - Reader task reads from pipe
    // - Writer task writes to pipe via channel
    // - We need to handle the fact that NamedPipeServer is not Clone

    // Actually, NamedPipeServer can be split using tokio::io::split
    // But for named pipes, we need to be careful about concurrent access

    // Let's use a simpler approach: single task handles both read and write
    // with non-blocking checks

    let mut read_buf = vec![0u8; 64 * 1024];
    let mut accum_buf = Vec::new();

    loop {
        // Check if there are messages to send (non-blocking)
        while let Ok(frame) = rx.try_recv() {
            if let Err(e) = pipe.write_all(&frame).await {
                log::error!("[Pipe] Write error: {}", e);
                return Err(Box::new(e));
            }
        }

        // Try to read from pipe (with timeout to allow checking channel)
        match tokio::time::timeout(
            std::time::Duration::from_millis(100),
            pipe.read(&mut read_buf)
        ).await {
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

                            // Dispatch to session manager, passing sender for future commands
                            let response = session_mgr.handle_message(msg, Some(tx.clone())).await;

                            // Send response
                            let frame = encode_frame(&response.response);
                            if let Err(e) = pipe.write_all(&frame).await {
                                log::error!("[Pipe] Write error: {}", e);
                                return Err(Box::new(e));
                            }
                        }
                        Err(ProtocolError::InsufficientData) => {
                            // Need more data
                            break;
                        }
                        Err(ProtocolError::JsonParse(e)) => {
                            log::error!("[Pipe] Protocol error: {}. Disconnecting client.", e);
                            return Err(format!("protocol error: {}", e).into());
                        }
                        Err(ProtocolError::Io(e)) => {
                            return Err(Box::new(e));
                        }
                    }
                }

                // Guard against oversized frames
                if accum_buf.len() > MAX_FRAME_SIZE {
                    log::error!(
                        "[Pipe] Frame too large ({} bytes). Disconnecting.",
                        accum_buf.len()
                    );
                    return Err("frame too large".into());
                }
            }
            Ok(Err(e)) => {
                log::error!("[Pipe] Read error: {}", e);
                return Err(Box::new(e));
            }
            Err(_) => {
                // Timeout - continue loop to check channel
                continue;
            }
        }
    }
}

/// Send a command to a connected VSTO session.
/// Called from the Desktop side (e.g., when user clicks "Insert" in the app).
pub async fn send_insert_formula(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    formula: FormulaPayload,
    mode: InsertMode,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::InsertFormula {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        formula,
        mode,
    };
    session_mgr.send_to_session(session_id, msg).await
}

pub async fn send_replace_formula(
    session_mgr: &Arc<SessionManager>,
    session_id: &str,
    formula_id: String,
    formula: FormulaPayload,
) -> Result<(), super::session::SendError> {
    let msg = DesktopMessage::ReplaceFormula {
        requestId: format!("cmd-{}", uuid_simple()),
        sessionId: session_id.to_string(),
        formulaId: formula_id,
        formula,
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
