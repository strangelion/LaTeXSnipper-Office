//! Ecosystem Bridge — Action Queue for cross-app plugin communication.
//!
//! Manages a FIFO queue of actions (InsertFormula, EditFormula, etc.) that
//! plugins (VS Code, Obsidian, Browser Extension, etc.) poll and acknowledge.
//!
//! Architecture:
//!   Desktop (or plugin) enqueues an action → plugin polls /actions/next →
//!   plugin acks → plugin completes → Desktop learns success/failure.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EcosystemActionEnvelope {
    pub action_id: String,
    pub action_type: String,

    pub origin: String,
    pub target: String,
    pub target_client_id: Option<String>,

    pub created_at: String,
    pub expires_at: String,
    pub timeout_ms: u64,
    pub nonce: String,
    pub require_ack: bool,

    pub allow_fallback: bool,
    pub priority: String,
    pub reply_to: Option<String>,

    pub payload: serde_json::Value,

    pub trace_id: String,
    pub app_version: Option<String>,
    pub protocol_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EcosystemActionStatus {
    Queued,
    Dispatched,
    Acked,
    Running,
    Completed,
    Failed,
    Canceled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemActionRecord {
    pub action: EcosystemActionEnvelope,
    pub status: EcosystemActionStatus,
    pub updated_at: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<ActionError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EcosystemClient {
    pub client_id: String,
    pub client_type: String,
    pub client_name: String,
    pub capabilities: Vec<String>,
    pub version: String,
    #[serde(default)]
    pub last_seen: String,
    #[serde(default)]
    pub connected_at: String,
}

// ---------------------------------------------------------------------------
// Inner state
// ---------------------------------------------------------------------------

struct ActionQueueInner {
    /// Per-target or per-client queues
    pub queues: HashMap<String, VecDeque<EcosystemActionEnvelope>>,
    /// Full status index keyed by actionId
    pub statuses: HashMap<String, EcosystemActionRecord>,
    /// Registered clients
    pub clients: HashMap<String, EcosystemClient>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct EcosystemActionQueue {
    inner: Arc<Mutex<ActionQueueInner>>,
}

impl EcosystemActionQueue {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ActionQueueInner {
                queues: HashMap::new(),
                statuses: HashMap::new(),
                clients: HashMap::new(),
            })),
        }
    }

    /// Enqueue an action for a target client.
    pub async fn enqueue(&self, action: EcosystemActionEnvelope) -> Result<(), String> {
        let mut inner = self.inner.lock().await;

        let target_key = action
            .target_client_id
            .clone()
            .unwrap_or_else(|| action.target.clone());

        inner
            .queues
            .entry(target_key)
            .or_default()
            .push_back(action.clone());

        let now = chrono::Utc::now().to_rfc3339();
        inner.statuses.insert(
            action.action_id.clone(),
            EcosystemActionRecord {
                action,
                status: EcosystemActionStatus::Queued,
                updated_at: now,
                result: None,
                error: None,
            },
        );

        Ok(())
    }

    /// Dequeue the next pending action for a client (by clientId or target).
    pub async fn next(
        &self,
        client_id: &str,
        target: &str,
    ) -> Option<EcosystemActionEnvelope> {
        let mut inner = self.inner.lock().await;

        // Prefer client-specific queue
        if let Some(q) = inner.queues.get_mut(client_id) {
            if let Some(action) = q.pop_front() {
                let id = action.action_id.clone();
                if let Some(record) = inner.statuses.get_mut(&id) {
                    record.status = EcosystemActionStatus::Dispatched;
                    record.updated_at = chrono::Utc::now().to_rfc3339();
                }
                return Some(action);
            }
        }

        // Fallback to target-based queue
        if let Some(q) = inner.queues.get_mut(target) {
            if let Some(action) = q.pop_front() {
                let id = action.action_id.clone();
                if let Some(record) = inner.statuses.get_mut(&id) {
                    record.status = EcosystemActionStatus::Dispatched;
                    record.updated_at = chrono::Utc::now().to_rfc3339();
                }
                return Some(action);
            }
        }

        None
    }

    /// Acknowledge an action (plugin received it).
    pub async fn ack(&self, action_id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let record = inner
            .statuses
            .get_mut(action_id)
            .ok_or_else(|| "Action not found".to_string())?;
        record.status = EcosystemActionStatus::Acked;
        record.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(())
    }

    /// Mark an action as completed (with result) or failed.
    pub async fn complete(
        &self,
        action_id: &str,
        ok: bool,
        result: Option<serde_json::Value>,
        error: Option<ActionError>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let record = inner
            .statuses
            .get_mut(action_id)
            .ok_or_else(|| "Action not found".to_string())?;
        record.status = if ok {
            EcosystemActionStatus::Completed
        } else {
            EcosystemActionStatus::Failed
        };
        record.updated_at = chrono::Utc::now().to_rfc3339();
        record.result = result;
        record.error = error;
        Ok(())
    }

    /// Get status of an action.
    pub async fn status(&self, action_id: &str) -> Option<EcosystemActionRecord> {
        let inner = self.inner.lock().await;
        inner.statuses.get(action_id).cloned()
    }

    /// Register or update a client.
    pub async fn register_client(&self, client: EcosystemClient) {
        let mut inner = self.inner.lock().await;
        let now = chrono::Utc::now().to_rfc3339();
        let mut c = client;
        c.last_seen = now.clone();
        c.connected_at = now;
        inner.clients.insert(c.client_id.clone(), c);
    }

    /// Update client heartbeat timestamp.
    pub async fn client_heartbeat(&self, client_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.clients.get_mut(client_id) {
            client.last_seen = chrono::Utc::now().to_rfc3339();
        }
    }

    /// List all registered clients.
    pub async fn list_clients(&self) -> Vec<EcosystemClient> {
        let inner = self.inner.lock().await;
        inner.clients.values().cloned().collect()
    }
}

impl Default for EcosystemActionQueue {
    fn default() -> Self {
        Self::new()
    }
}
