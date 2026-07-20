//! Commit Coordinator for Office live editing.
//!
//! Tracks the mapping between pipe-level `requestId` and transaction-level
//! `transactionId`. When a `ReplaceResult` arrives from the VSTO host, the
//! coordinator resolves which transaction it belongs to so the durable store
//! can be updated correctly.
//!
//! This solves the problem identified in TUG 2026 analysis:
//! - "native replace 命令是 send-only 风格" → we now await real host result
//! - "requestId -> transactionId 关联" → tracked in CommitCoordinator
//! - "ReplaceResult 信息不够" → enriched with formulaId/revision

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A pending commit that is waiting for host confirmation.
#[derive(Debug, Clone)]
pub struct PendingCommit {
    pub request_id: String,
    pub transaction_id: String,
    pub formula_id: String,
    pub session_id: String,
    pub document_id: Option<String>,
    pub created_at_ms: u64,
}

/// Result of a host commit operation.
#[derive(Debug, Clone)]
pub struct CommitResult {
    pub transaction_id: String,
    pub formula_id: String,
    pub success: bool,
    pub revision: Option<u64>,
    pub actual_storage_mode: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
}

/// Payload from a ReplaceResult event from the VSTO host.
#[derive(Debug, Clone)]
pub struct ReplaceResultPayload {
    pub success: bool,
    pub formula_id: Option<String>,
    pub revision: Option<u64>,
    pub actual_storage_mode: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
}

/// Coordinator that tracks in-flight commits between Desktop and VSTO host.
pub struct CommitCoordinator {
    pending: Mutex<HashMap<String, PendingCommit>>,
}

impl CommitCoordinator {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            pending: Mutex::new(HashMap::new()),
        })
    }

    /// Register a new pending commit before sending the replace command.
    pub async fn register_commit(
        &self,
        request_id: String,
        transaction_id: String,
        formula_id: String,
        session_id: String,
        document_id: Option<String>,
    ) {
        let commit = PendingCommit {
            request_id: request_id.clone(),
            transaction_id: transaction_id.clone(),
            formula_id,
            session_id,
            document_id,
            created_at_ms: now_ms(),
        };
        self.pending.lock().await.insert(request_id, commit);
        log::debug!(
            "[CommitCoordinator] Registered commit: transaction={}, request={}",
            transaction_id,
            transaction_id
        );
    }

    /// Resolve a ReplaceResult from the host to a CommitResult.
    /// Returns None if the requestId is unknown (already resolved or stale).
    pub async fn resolve_result(
        &self,
        request_id: &str,
        result: ReplaceResultPayload,
    ) -> Option<CommitResult> {
        let commit = self.pending.lock().await.remove(request_id)?;

        log::info!(
            "[CommitCoordinator] Resolved result: transaction={}, success={}",
            commit.transaction_id,
            result.success
        );

        Some(CommitResult {
            transaction_id: commit.transaction_id,
            formula_id: result.formula_id.unwrap_or(commit.formula_id),
            success: result.success,
            revision: result.revision,
            actual_storage_mode: result.actual_storage_mode,
            error_code: result.error_code,
            error: result.error,
        })
    }

    /// Look up a pending commit by request ID without removing it.
    pub async fn get_pending(&self, request_id: &str) -> Option<PendingCommit> {
        self.pending.lock().await.get(request_id).cloned()
    }

    /// Look up a pending commit by transaction ID.
    pub async fn get_pending_by_transaction(&self, transaction_id: &str) -> Option<PendingCommit> {
        self.pending
            .lock()
            .await
            .values()
            .find(|c| c.transaction_id == transaction_id)
            .cloned()
    }

    /// Cancel a pending commit (e.g., if the user cancels before host responds).
    pub async fn cancel_commit(&self, request_id: &str) -> Option<PendingCommit> {
        self.pending.lock().await.remove(request_id)
    }

    /// Cancel all pending commits for a given transaction.
    pub async fn cancel_transaction_commits(&self, transaction_id: &str) -> Vec<PendingCommit> {
        let mut pending = self.pending.lock().await;
        let to_remove: Vec<String> = pending
            .iter()
            .filter(|(_, c)| c.transaction_id == transaction_id)
            .map(|(id, _)| id.clone())
            .collect();
        to_remove
            .iter()
            .filter_map(|id| pending.remove(id))
            .collect()
    }

    /// Clean up stale pending commits older than the given duration.
    pub async fn cleanup_stale(&self, max_age_ms: u64) -> Vec<PendingCommit> {
        let now = now_ms();
        let mut pending = self.pending.lock().await;
        let stale: Vec<String> = pending
            .iter()
            .filter(|(_, c)| now.saturating_sub(c.created_at_ms) > max_age_ms)
            .map(|(id, _)| id.clone())
            .collect();
        stale.iter().filter_map(|id| pending.remove(id)).collect()
    }

    /// Get the number of pending commits.
    pub async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

use tauri::State;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPendingCommitRequest {
    pub request_id: String,
    pub transaction_id: String,
    pub formula_id: String,
    pub session_id: String,
    pub document_id: Option<String>,
}

#[tauri::command]
pub async fn register_pending_commit(
    coordinator: State<'_, Arc<CommitCoordinator>>,
    request: RegisterPendingCommitRequest,
) -> Result<(), String> {
    coordinator
        .register_commit(
            request.request_id,
            request.transaction_id,
            request.formula_id,
            request.session_id,
            request.document_id,
        )
        .await;
    Ok(())
}

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
    async fn register_and_resolve() {
        let coord = CommitCoordinator::new();
        coord
            .register_commit(
                "req-1".into(),
                "tx-1".into(),
                "formula-1".into(),
                "session-1".into(),
                Some("doc-1".into()),
            )
            .await;

        let result = coord
            .resolve_result(
                "req-1",
                ReplaceResultPayload {
                    success: true,
                    formula_id: Some("formula-1".into()),
                    revision: Some(2),
                    actual_storage_mode: Some("native-omml".into()),
                    error_code: None,
                    error: None,
                },
            )
            .await;

        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.transaction_id, "tx-1");
        assert!(r.success);
        assert_eq!(r.revision, Some(2));
    }

    #[tokio::test]
    async fn unknown_request_returns_none() {
        let coord = CommitCoordinator::new();
        let result = coord
            .resolve_result(
                "unknown",
                ReplaceResultPayload {
                    success: true,
                    formula_id: None,
                    revision: None,
                    actual_storage_mode: None,
                    error_code: None,
                    error: None,
                },
            )
            .await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cancel_removes_pending() {
        let coord = CommitCoordinator::new();
        coord
            .register_commit(
                "req-1".into(),
                "tx-1".into(),
                "f1".into(),
                "s1".into(),
                None,
            )
            .await;
        let cancelled = coord.cancel_commit("req-1").await;
        assert!(cancelled.is_some());
        assert_eq!(cancelled.unwrap().transaction_id, "tx-1");
        // Should not resolve after cancel
        let result = coord
            .resolve_result(
                "req-1",
                ReplaceResultPayload {
                    success: true,
                    formula_id: None,
                    revision: None,
                    actual_storage_mode: None,
                    error_code: None,
                    error: None,
                },
            )
            .await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cancel_transaction_removes_all() {
        let coord = CommitCoordinator::new();
        coord
            .register_commit(
                "req-1".into(),
                "tx-1".into(),
                "f1".into(),
                "s1".into(),
                None,
            )
            .await;
        coord
            .register_commit(
                "req-2".into(),
                "tx-1".into(),
                "f2".into(),
                "s1".into(),
                None,
            )
            .await;
        coord
            .register_commit(
                "req-3".into(),
                "tx-2".into(),
                "f3".into(),
                "s1".into(),
                None,
            )
            .await;

        let cancelled = coord.cancel_transaction_commits("tx-1").await;
        assert_eq!(cancelled.len(), 2);
        assert_eq!(coord.pending_count().await, 1);
    }

    #[tokio::test]
    async fn lookup_by_transaction() {
        let coord = CommitCoordinator::new();
        coord
            .register_commit(
                "req-1".into(),
                "tx-1".into(),
                "f1".into(),
                "s1".into(),
                None,
            )
            .await;

        let found = coord.get_pending_by_transaction("tx-1").await;
        assert!(found.is_some());
        assert_eq!(found.unwrap().request_id, "req-1");

        let not_found = coord.get_pending_by_transaction("tx-999").await;
        assert!(not_found.is_none());
    }
}
