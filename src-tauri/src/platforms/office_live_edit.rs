//! Volatile in-memory layer for real-time Office formula editing.
//!
//! Sits above the durable `OfficeEditTransactionStore` to handle high-frequency
//! keystroke-driven updates without the fsync overhead of persistent storage.
//!
//! Architecture:
//! - `OfficeEditTransaction` = durable (crash recovery, ownership, commit lifecycle)
//! - `LiveOfficeEditSession` = volatile (per-keystroke, debounce, preview state)
//! - Linked by `transaction_id`
//!
//! Durable checkpoints happen only at: focus loss, app close, manual save,
//! low-frequency timer, or before commit -- never per keystroke.

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// Render generation counter. Incremented on every new input to enable
/// latest-wins semantics: when a render completes, its generation is checked
/// against the current session generation; stale results are discarded.
pub type RenderGeneration = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveRenderState {
    Idle,
    Pending,
    InFlight,
    Completed,
    Cancelled,
}

/// A volatile in-memory editing session for a single formula.
///
/// Created when a user opens a formula for editing (via OPEN_EDITOR).
/// Destroyed when the user commits, cancels, or the session expires.
///
/// This struct intentionally avoids any disk I/O. All mutations are in-memory
/// only. Durable state is synchronized to `OfficeEditTransactionStore` at
/// controlled checkpoints.
#[derive(Debug, Clone)]
pub struct LiveOfficeEditSession {
    /// Links to the durable transaction.
    pub transaction_id: String,

    /// Monotonically increasing draft revision. Incremented on every input.
    pub draft_revision: RenderGeneration,

    /// Current LaTeX source text being edited.
    pub current_latex: String,

    /// Current display mode ("inline" | "block" | "numbered").
    pub display_mode: String,

    /// Current numbering options (only used when display_mode == "numbered").
    pub numbering: Option<super::office_transactions::EquationNumberingOptions>,

    /// The render generation of the most recently submitted render request.
    pub render_generation: RenderGeneration,

    /// Current state of the render pipeline.
    pub render_state: LiveRenderState,

    /// Whether the session has unsynchronized changes (needs durable checkpoint).
    pub dirty: bool,

    /// Timestamp of the last durable checkpoint (epoch ms).
    pub last_checkpoint_ms: u64,

    /// Timestamp when this session was created (epoch ms).
    pub created_at_ms: u64,

    /// Timestamp of the last input mutation (epoch ms).
    pub last_input_ms: u64,

    /// Session expiry time (epoch ms). Auto-cancelled if not committed before this.
    pub expires_at_ms: u64,
}

/// Result of a live render operation. Carries the rendered output along with
/// generation metadata so the consumer can discard stale results.
#[derive(Debug, Clone)]
pub struct LiveRenderResult {
    pub transaction_id: String,
    pub draft_revision: RenderGeneration,
    pub render_generation: RenderGeneration,
    pub latex: String,
    pub omml: Option<String>,
    pub svg: Option<String>,
    pub png: Option<String>,
    pub width_pt: Option<f32>,
    pub height_pt: Option<f32>,
    pub diagnostics: Vec<RenderDiagnostic>,
}

#[derive(Debug, Clone)]
pub struct RenderDiagnostic {
    pub level: String,
    pub message: String,
}

/// Snapshot of the current live session state, suitable for sending to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionSnapshot {
    pub transaction_id: String,
    pub draft_revision: RenderGeneration,
    pub current_latex: String,
    pub display_mode: String,
    pub render_generation: RenderGeneration,
    pub render_state: LiveRenderState,
    pub dirty: bool,
    pub age_ms: u64,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default session TTL: 30 minutes of inactivity before auto-cancel.
const DEFAULT_SESSION_TTL_MS: u64 = 30 * 60 * 1000;

/// Minimum interval between durable checkpoints to avoid excessive fsync.
const MIN_CHECKPOINT_INTERVAL_MS: u64 = 5_000;

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/// In-memory store for all active live editing sessions.
///
/// This is a Tauri managed state. It lives for the lifetime of the application
/// and is never persisted to disk. On application restart, sessions are lost
/// but can be recovered from the durable `OfficeEditTransactionStore`.
pub struct LiveOfficeEditSessionStore {
    sessions: Mutex<HashMap<String, LiveOfficeEditSession>>,
    generation_counter: AtomicU64,
}

impl LiveOfficeEditSessionStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            generation_counter: AtomicU64::new(1),
        })
    }

    /// Create a new live editing session for the given transaction.
    ///
    /// Fails if a session already exists for this transaction (duplicate open).
    pub async fn create(
        &self,
        transaction_id: String,
        initial_latex: String,
        display_mode: String,
        numbering: Option<super::office_transactions::EquationNumberingOptions>,
    ) -> Result<LiveOfficeEditSession, String> {
        let now = now_ms();
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(&transaction_id) {
            return Err(format!(
                "LIVE_SESSION_EXISTS: session already active for transaction {}",
                transaction_id
            ));
        }

        let session = LiveOfficeEditSession {
            transaction_id: transaction_id.clone(),
            draft_revision: 1,
            current_latex: initial_latex,
            display_mode,
            numbering,
            render_generation: 0,
            render_state: LiveRenderState::Idle,
            dirty: false,
            last_checkpoint_ms: now,
            created_at_ms: now,
            last_input_ms: now,
            expires_at_ms: now.saturating_add(DEFAULT_SESSION_TTL_MS),
        };

        sessions.insert(transaction_id.clone(), session.clone());
        log::info!(
            "[LiveEdit] Created session for transaction {}",
            transaction_id
        );
        Ok(session)
    }

    /// Update the draft LaTeX content. This is the high-frequency path called
    /// on every keystroke. It does NOT touch the durable store.
    pub async fn update_draft(
        &self,
        transaction_id: &str,
        latex: String,
        display_mode: Option<String>,
        numbering: Option<super::office_transactions::EquationNumberingOptions>,
    ) -> Result<LiveOfficeEditSession, String> {
        let now = now_ms();
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;

        if session.expires_at_ms <= now {
            return Err("LIVE_SESSION_EXPIRED".to_string());
        }

        session.current_latex = latex;
        if let Some(mode) = display_mode {
            session.display_mode = mode;
        }
        if numbering.is_some() {
            session.numbering = numbering;
        }
        session.draft_revision += 1;
        session.dirty = true;
        session.last_input_ms = now;
        session.expires_at_ms = now.saturating_add(DEFAULT_SESSION_TTL_MS);

        // Cancel any in-flight render since we have new input
        if session.render_state == LiveRenderState::InFlight
            || session.render_state == LiveRenderState::Pending
        {
            session.render_state = LiveRenderState::Cancelled;
        }

        Ok(session.clone())
    }

    /// Submit a render request. Returns the new render generation and increments
    /// the session's render_generation counter.
    pub async fn submit_render(
        &self,
        transaction_id: &str,
    ) -> Result<(RenderGeneration, LiveOfficeEditSession), String> {
        let now = now_ms();
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;

        if session.expires_at_ms <= now {
            return Err("LIVE_SESSION_EXPIRED".to_string());
        }

        session.render_generation += 1;
        session.render_state = LiveRenderState::InFlight;

        Ok((session.render_generation, session.clone()))
    }

    /// Complete a render. Returns Some(()) if the generation is current,
    /// None if stale (latest-wins discard).
    pub async fn complete_render(
        &self,
        transaction_id: &str,
        render_generation: RenderGeneration,
    ) -> Result<Option<()>, String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;

        if session.render_generation != render_generation {
            log::debug!(
                "[LiveEdit] Discarding stale render gen={} (current={}) for {}",
                render_generation,
                session.render_generation,
                transaction_id
            );
            return Ok(None);
        }

        session.render_state = LiveRenderState::Completed;
        Ok(Some(()))
    }

    /// Mark a render as cancelled.
    pub async fn cancel_render(&self, transaction_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;
        session.render_state = LiveRenderState::Cancelled;
        Ok(())
    }

    /// Check if a durable checkpoint is needed (dirty + sufficient time elapsed).
    pub async fn needs_checkpoint(&self, transaction_id: &str) -> Result<bool, String> {
        let now = now_ms();
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;
        Ok(session.dirty
            && now.saturating_sub(session.last_checkpoint_ms) >= MIN_CHECKPOINT_INTERVAL_MS)
    }

    /// Clear the dirty flag after a successful durable checkpoint.
    pub async fn clear_dirty(&self, transaction_id: &str) -> Result<(), String> {
        let now = now_ms();
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;
        session.dirty = false;
        session.last_checkpoint_ms = now;
        Ok(())
    }

    /// Get a snapshot of the session state for the frontend.
    pub async fn get_snapshot(
        &self,
        transaction_id: &str,
    ) -> Result<LiveSessionSnapshot, String> {
        let now = now_ms();
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(transaction_id)
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())?;

        Ok(LiveSessionSnapshot {
            transaction_id: session.transaction_id.clone(),
            draft_revision: session.draft_revision,
            current_latex: session.current_latex.clone(),
            display_mode: session.display_mode.clone(),
            render_generation: session.render_generation,
            render_state: session.render_state,
            dirty: session.dirty,
            age_ms: now.saturating_sub(session.created_at_ms),
        })
    }

    /// Get the full session data (for commit preparation).
    pub async fn get(&self, transaction_id: &str) -> Result<LiveOfficeEditSession, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(transaction_id)
            .cloned()
            .ok_or_else(|| "LIVE_SESSION_NOT_FOUND".to_string())
    }

    /// Close and remove a session. Called after commit, cancel, or expiry.
    pub async fn close(&self, transaction_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(transaction_id);
        log::info!(
            "[LiveEdit] Closed session for transaction {}",
            transaction_id
        );
        Ok(())
    }

    /// Check for and remove expired sessions. Returns IDs of expired sessions.
    pub async fn cleanup_expired(&self) -> Vec<String> {
        let now = now_ms();
        let mut sessions = self.sessions.lock().await;
        let expired: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| s.expires_at_ms <= now)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &expired {
            sessions.remove(id);
            log::info!("[LiveEdit] Expired session {}", id);
        }
        expired
    }

    /// List all active sessions.
    pub async fn list_active(&self) -> Vec<LiveSessionSnapshot> {
        let now = now_ms();
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .filter(|s| s.expires_at_ms > now)
            .map(|s| LiveSessionSnapshot {
                transaction_id: s.transaction_id.clone(),
                draft_revision: s.draft_revision,
                current_latex: s.current_latex.clone(),
                display_mode: s.display_mode.clone(),
                render_generation: s.render_generation,
                render_state: s.render_state,
                dirty: s.dirty,
                age_ms: now.saturating_sub(s.created_at_ms),
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

use tauri::State;

#[tauri::command]
pub async fn start_live_office_edit(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
    initial_latex: String,
    display_mode: String,
    numbering: Option<super::office_transactions::EquationNumberingOptions>,
) -> Result<LiveSessionSnapshot, String> {
    let session = store
        .create(transaction_id, initial_latex, display_mode, numbering)
        .await?;
    Ok(LiveSessionSnapshot {
        transaction_id: session.transaction_id,
        draft_revision: session.draft_revision,
        current_latex: session.current_latex,
        display_mode: session.display_mode,
        render_generation: session.render_generation,
        render_state: session.render_state,
        dirty: session.dirty,
        age_ms: 0,
    })
}

#[tauri::command]
pub async fn update_live_office_draft(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
    latex: String,
    display_mode: Option<String>,
    numbering: Option<super::office_transactions::EquationNumberingOptions>,
) -> Result<LiveSessionSnapshot, String> {
    let session = store
        .update_draft(&transaction_id, latex, display_mode, numbering)
        .await?;
    Ok(LiveSessionSnapshot {
        transaction_id: session.transaction_id,
        draft_revision: session.draft_revision,
        current_latex: session.current_latex,
        display_mode: session.display_mode,
        render_generation: session.render_generation,
        render_state: session.render_state,
        dirty: session.dirty,
        age_ms: now_ms().saturating_sub(session.created_at_ms),
    })
}

#[tauri::command]
pub async fn submit_live_office_render(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
) -> Result<(RenderGeneration, LiveSessionSnapshot), String> {
    let (gen, session) = store.submit_render(&transaction_id).await?;
    Ok((
        gen,
        LiveSessionSnapshot {
            transaction_id: session.transaction_id,
            draft_revision: session.draft_revision,
            current_latex: session.current_latex,
            display_mode: session.display_mode,
            render_generation: session.render_generation,
            render_state: session.render_state,
            dirty: session.dirty,
            age_ms: now_ms().saturating_sub(session.created_at_ms),
        },
    ))
}

#[tauri::command]
pub async fn get_live_office_snapshot(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
) -> Result<LiveSessionSnapshot, String> {
    store.get_snapshot(&transaction_id).await
}

#[tauri::command]
pub async fn close_live_office_edit(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
) -> Result<(), String> {
    store.close(&transaction_id).await
}

#[tauri::command]
pub async fn list_active_live_office_sessions(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
) -> Result<Vec<LiveSessionSnapshot>, String> {
    Ok(store.list_active().await)
}

#[tauri::command]
pub async fn checkpoint_live_office_dirty(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
) -> Result<(), String> {
    store.clear_dirty(&transaction_id).await
}

#[tauri::command]
pub async fn needs_live_office_checkpoint(
    store: State<'_, Arc<LiveOfficeEditSessionStore>>,
    transaction_id: String,
) -> Result<bool, String> {
    store.needs_checkpoint(&transaction_id).await
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_and_update_session() {
        let store = LiveOfficeEditSessionStore::new();
        let session = store
            .create("tx-1".into(), "x^2".into(), "block".into(), None)
            .await
            .unwrap();
        assert_eq!(session.draft_revision, 1);
        assert!(!session.dirty);

        let updated = store
            .update_draft("tx-1", "x^3".into(), None, None)
            .await
            .unwrap();
        assert_eq!(updated.draft_revision, 2);
        assert_eq!(updated.current_latex, "x^3");
        assert!(updated.dirty);
    }

    #[tokio::test]
    async fn duplicate_session_is_rejected() {
        let store = LiveOfficeEditSessionStore::new();
        store
            .create("tx-1".into(), "".into(), "block".into(), None)
            .await
            .unwrap();
        let err = store
            .create("tx-1".into(), "".into(), "block".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("LIVE_SESSION_EXISTS"));
    }

    #[tokio::test]
    async fn render_generation_latest_wins() {
        let store = LiveOfficeEditSessionStore::new();
        store
            .create("tx-1".into(), "x^2".into(), "block".into(), None)
            .await
            .unwrap();

        let (gen1, _) = store.submit_render("tx-1").await.unwrap();
        assert_eq!(gen1, 1);

        // New input arrives, render cancelled
        store
            .update_draft("tx-1", "x^3".into(), None, None)
            .await
            .unwrap();

        let (gen2, _) = store.submit_render("tx-1").await.unwrap();
        assert_eq!(gen2, 2);

        // Stale render for gen1 should be discarded
        let result = store.complete_render("tx-1", gen1).await.unwrap();
        assert!(result.is_none());

        // Current render for gen2 is valid
        let result = store.complete_render("tx-1", gen2).await.unwrap();
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn session_expiry() {
        let store = LiveOfficeEditSessionStore::new();
        store
            .create("tx-1".into(), "".into(), "block".into(), None)
            .await
            .unwrap();

        // Simulate expiry by directly manipulating the store
        {
            let mut sessions = store.sessions.lock().await;
            if let Some(s) = sessions.get_mut("tx-1") {
                s.expires_at_ms = 0;
            }
        }

        let err = store
            .update_draft("tx-1", "x".into(), None, None)
            .await
            .unwrap_err();
        assert!(err.contains("LIVE_SESSION_EXPIRED"));

        let expired = store.cleanup_expired().await;
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0], "tx-1");
    }

    #[tokio::test]
    async fn close_session() {
        let store = LiveOfficeEditSessionStore::new();
        store
            .create("tx-1".into(), "".into(), "block".into(), None)
            .await
            .unwrap();
        store.close("tx-1").await.unwrap();
        assert!(store.get("tx-1").await.is_err());
    }

    #[tokio::test]
    async fn snapshot_reflects_state() {
        let store = LiveOfficeEditSessionStore::new();
        store
            .create("tx-1".into(), "x^2".into(), "block".into(), None)
            .await
            .unwrap();
        store
            .update_draft("tx-1", "x^3".into(), None, None)
            .await
            .unwrap();

        let snap = store.get_snapshot("tx-1").await.unwrap();
        assert_eq!(snap.draft_revision, 2);
        assert_eq!(snap.current_latex, "x^3");
        assert!(snap.dirty);
    }
}
