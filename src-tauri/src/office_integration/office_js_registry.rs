// Office.js session registry for cross-platform Auto route fallback.
//
// Office.js TaskPane sends periodic heartbeat via Bridge API.
// The Coordinator checks this registry when Native Office is unavailable.

use std::collections::HashMap;
use tokio::sync::RwLock;

/// A live Office.js TaskPane session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeJsSession {
    pub client_id: String,
    pub host: String,
    pub document_context: String,
    pub document_title: Option<String>,
    pub last_seen_utc: chrono::DateTime<chrono::Utc>,
}

/// Registry of active Office.js TaskPane sessions.
#[allow(dead_code)]
pub struct OfficeJsSessionRegistry {
    sessions: RwLock<HashMap<String, OfficeJsSession>>,
}

#[allow(dead_code)]
impl OfficeJsSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn heartbeat(&self, mut session: OfficeJsSession) {
        session.last_seen_utc = chrono::Utc::now();
        self.sessions
            .write()
            .await
            .insert(session.client_id.clone(), session);
    }

    pub async fn resolve_fresh(
        &self,
        host: &str,
        document_context: Option<&str>,
    ) -> Result<OfficeJsSession, String> {
        let cutoff = chrono::Utc::now() - chrono::Duration::seconds(15);
        let sessions = self.sessions.read().await;
        let matching: Vec<_> = sessions
            .values()
            .filter(|s| s.last_seen_utc >= cutoff && s.host.eq_ignore_ascii_case(host))
            .filter(|s| {
                document_context
                    .map(|e| s.document_context == e)
                    .unwrap_or(true)
            })
            .cloned()
            .collect();
        match matching.as_slice() {
            [] => Err(format!("No active Office.js {host} client")),
            [session] => Ok(session.clone()),
            _ => Err(format!(
                "Multiple active Office.js {host} clients require document context"
            )),
        }
    }
}

impl Default for OfficeJsSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}
