use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

const SCHEMA_VERSION: u32 = 1;
const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const MAX_MESSAGES: usize = 500;
const MAX_BLOCKS: usize = 10_000;
const MAX_TEXT_CHARS: usize = 2 * 1024 * 1024;
const MAX_TABLE_CELLS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationImportDocument {
    pub schema_version: u32,
    pub import_id: String,
    pub provider: String,
    pub provider_adapter_version: String,
    pub source_url: String,
    pub source_title: Option<String>,
    pub source_language: Option<String>,
    pub extracted_at: String,
    pub scope: Value,
    pub messages: Vec<ConversationImportMessage>,
    pub truncated: bool,
    pub truncation: Option<Value>,
    #[serde(default)]
    pub diagnostics: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationImportMessage {
    pub id: String,
    pub role: String,
    pub sequence: u32,
    pub language: Option<String>,
    pub blocks: Vec<ConversationImportBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ConversationImportBlock {
    Paragraph {
        runs: Vec<InlineRun>,
    },
    Heading {
        level: Option<u8>,
        runs: Vec<InlineRun>,
    },
    Quote {
        runs: Vec<InlineRun>,
    },
    LinkParagraph {
        runs: Vec<InlineRun>,
    },
    AttachmentLabel {
        runs: Vec<InlineRun>,
    },
    List {
        ordered: bool,
        level: u8,
        items: Vec<Vec<InlineRun>>,
    },
    Formula {
        formula: FormulaCandidate,
        original_number_label: Option<String>,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    Table {
        rows: Vec<Vec<String>>,
        header_rows: u32,
        column_count: u32,
    },
    HorizontalRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineRun {
    #[serde(rename = "type")]
    pub run_type: String,
    pub text: Option<String>,
    pub href: Option<String>,
    pub formula: Option<FormulaCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaCandidate {
    pub id: String,
    pub raw_source: String,
    pub normalized_latex: Option<String>,
    pub mathml: Option<String>,
    pub display_mode: String,
    pub source: String,
    pub renderer: String,
    pub confidence: f64,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BrowserImportStatus {
    Received,
    ValidationFailed,
    AwaitingPreview,
    AwaitingDestination,
    ReadyToCommit,
    Committing,
    Completed,
    Cancelled,
    Failed,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportRecord {
    pub action_id: String,
    pub received_at: String,
    pub status: BrowserImportStatus,
    pub source_browser: String,
    pub document: ConversationImportDocument,
    pub selected_message_ids: Vec<String>,
    pub import_mode: String,
    pub template: String,
    pub formula_numbering: String,
    pub destination_session_id: Option<String>,
    pub expected_document_id: Option<String>,
    pub last_error: Option<ImportDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiagnostic {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportPreviewUpdate {
    pub action_id: String,
    pub selected_message_ids: Vec<String>,
    pub import_mode: String,
    pub template: String,
    pub formula_numbering: String,
    pub destination_session_id: Option<String>,
    pub expected_document_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordImportPlan {
    pub plan_id: String,
    pub import_id: String,
    pub operations: Vec<WordImportOperation>,
    pub diagnostics: Vec<ImportDiagnostic>,
    pub can_commit: bool,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordImportOperation {
    pub kind: String,
    pub text: Option<String>,
    pub level: Option<u32>,
    pub ordered: Option<bool>,
    pub rows: Option<Vec<Vec<String>>>,
    pub omml: Option<String>,
    pub display: Option<bool>,
    pub style: Option<String>,
}

#[derive(Clone)]
pub struct ConversationImportStore {
    root: PathBuf,
    records: Arc<RwLock<Vec<BrowserImportRecord>>>,
}

impl ConversationImportStore {
    pub fn new() -> Result<Self, String> {
        let root = dirs_next::data_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("LaTeXSnipper")
            .join("browser-imports");
        Self::new_with_root(root)
    }

    fn new_with_root(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("Cannot create browser import store: {e}"))?;
        let records = load_persisted_records(&root)?;
        Ok(Self {
            root,
            records: Arc::new(RwLock::new(records)),
        })
    }

    pub async fn receive(
        &self,
        action_id: String,
        browser: String,
        document: ConversationImportDocument,
    ) -> Result<BrowserImportRecord, ImportDiagnostic> {
        validate_document(&document)?;
        let record = BrowserImportRecord {
            action_id,
            received_at: chrono::Utc::now().to_rfc3339(),
            status: BrowserImportStatus::AwaitingPreview,
            source_browser: browser,
            selected_message_ids: default_qa_ids(&document),
            import_mode: "question-and-answer".into(),
            template: "clean-notes".into(),
            formula_numbering: "none".into(),
            destination_session_id: None,
            expected_document_id: None,
            last_error: None,
            document,
        };
        self.persist(&record).map_err(|message| ImportDiagnostic {
            code: "IMPORT_PERSIST_FAILED".into(),
            message,
        })?;
        self.records.write().await.push(record.clone());
        Ok(record)
    }

    fn persist(&self, record: &BrowserImportRecord) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(record).map_err(|e| e.to_string())?;
        let path = self
            .root
            .join(format!("{}.json", safe_id(&record.action_id)));
        let temp = path.with_extension(format!("{}.tmp", new_uuid_v4()));
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        replace_persisted_file(&temp, &path)
    }

    pub async fn list(&self) -> Vec<BrowserImportRecord> {
        self.records.read().await.clone()
    }
    pub async fn get(&self, action_id: &str) -> Option<BrowserImportRecord> {
        self.records
            .read()
            .await
            .iter()
            .find(|r| r.action_id == action_id)
            .cloned()
    }
    pub async fn update_preview(
        &self,
        request: BrowserImportPreviewUpdate,
    ) -> Result<BrowserImportRecord, String> {
        let mut records = self.records.write().await;
        let record = records
            .iter_mut()
            .find(|r| r.action_id == request.action_id)
            .ok_or("Browser import not found")?;
        let ids: HashSet<_> = record
            .document
            .messages
            .iter()
            .map(|m| m.id.as_str())
            .collect();
        if request.selected_message_ids.is_empty()
            || request
                .selected_message_ids
                .iter()
                .any(|id| !ids.contains(id.as_str()))
        {
            return Err("Invalid selected message IDs".into());
        }
        if !matches!(
            request.import_mode.as_str(),
            "formulas-only"
                | "current-message"
                | "question-and-answer"
                | "selected-message-range"
                | "full-loaded-conversation"
                | "structured-notes"
        ) {
            return Err("Invalid import mode".into());
        }
        if request.import_mode == "full-loaded-conversation"
            && !record
                .document
                .scope
                .get("explicitUserConfirmation")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            return Err("Full loaded conversation requires explicit confirmation".into());
        }
        if !matches!(
            request.formula_numbering.as_str(),
            "none" | "preserve-source-labels" | "selected" | "all-display"
        ) {
            return Err("Invalid numbering policy".into());
        }
        record.selected_message_ids = request.selected_message_ids;
        record.import_mode = request.import_mode;
        record.template = request.template;
        record.formula_numbering = request.formula_numbering;
        record.destination_session_id = request.destination_session_id;
        record.expected_document_id = request.expected_document_id;
        record.status = BrowserImportStatus::AwaitingDestination;
        let clone = record.clone();
        self.persist(&clone)?;
        Ok(clone)
    }

    pub async fn set_status(
        &self,
        action_id: &str,
        status: BrowserImportStatus,
        error: Option<ImportDiagnostic>,
    ) -> Result<(), String> {
        let mut records = self.records.write().await;
        let record = records
            .iter_mut()
            .find(|r| r.action_id == action_id)
            .ok_or("Browser import not found")?;
        record.status = status;
        record.last_error = error;
        self.persist(record)
    }
}

fn load_persisted_records(root: &Path) -> Result<Vec<BrowserImportRecord>, String> {
    let entries =
        std::fs::read_dir(root).map_err(|e| format!("Cannot read browser import store: {e}"))?;
    let mut by_action = HashMap::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read browser import entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let loaded = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<BrowserImportRecord>(&bytes).map_err(|e| e.to_string())
            })
            .and_then(|record| {
                validate_document(&record.document)
                    .map_err(|error| format!("{}: {}", error.code, error.message))?;
                if safe_id(&record.action_id).is_empty() {
                    return Err("Persisted browser import has an invalid action ID".into());
                }
                Ok(record)
            });
        match loaded {
            Ok(record) => {
                by_action.insert(record.action_id.clone(), record);
            }
            Err(error) => {
                let quarantine = path.with_extension(format!("{}.corrupt", new_uuid_v4()));
                std::fs::rename(&path, &quarantine).map_err(|rename_error| {
                    format!(
                        "Cannot quarantine corrupt browser import {} ({error}): {rename_error}",
                        path.display()
                    )
                })?;
            }
        }
    }
    let mut records: Vec<_> = by_action.into_values().collect();
    records.sort_by(|left, right| left.received_at.cmp(&right.received_at));
    Ok(records)
}

fn replace_persisted_file(temp: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return std::fs::rename(temp, destination).map_err(|e| e.to_string());
    }
    let backup = destination.with_extension(format!("{}.bak", new_uuid_v4()));
    std::fs::rename(destination, &backup).map_err(|e| e.to_string())?;
    if let Err(error) = std::fs::rename(temp, destination) {
        let _ = std::fs::rename(&backup, destination);
        let _ = std::fs::remove_file(temp);
        return Err(error.to_string());
    }
    std::fs::remove_file(&backup).map_err(|e| e.to_string())
}

fn safe_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect()
}
fn default_qa_ids(document: &ConversationImportDocument) -> Vec<String> {
    let assistant = document
        .messages
        .iter()
        .rposition(|m| m.role == "assistant")
        .unwrap_or_else(|| document.messages.len().saturating_sub(1));
    let user = document.messages[..assistant]
        .iter()
        .rposition(|m| m.role == "user");
    document
        .messages
        .iter()
        .enumerate()
        .filter(|(i, _)| *i == assistant || Some(*i) == user)
        .map(|(_, m)| m.id.clone())
        .collect()
}

pub fn validate_document(document: &ConversationImportDocument) -> Result<(), ImportDiagnostic> {
    let bytes = serde_json::to_vec(document).map_err(|e| ImportDiagnostic {
        code: "INVALID_JSON".into(),
        message: e.to_string(),
    })?;
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(diag("PAYLOAD_TOO_LARGE", "Browser import exceeds 2 MiB"));
    }
    if document.schema_version != SCHEMA_VERSION {
        return Err(diag(
            "UNSUPPORTED_SCHEMA",
            "Unsupported conversation schema",
        ));
    }
    if !(document.source_url.starts_with("https://") || document.source_url.starts_with("http://"))
    {
        return Err(diag(
            "UNSAFE_SOURCE_URL",
            "Source URL must use HTTP or HTTPS",
        ));
    }
    if document.messages.is_empty() || document.messages.len() > MAX_MESSAGES {
        return Err(diag(
            "INVALID_MESSAGE_COUNT",
            "Message count is outside bounds",
        ));
    }
    let mut ids = HashSet::new();
    let mut blocks = 0usize;
    let mut chars = 0usize;
    let mut cells = 0usize;
    for message in &document.messages {
        if !ids.insert(&message.id) {
            return Err(diag("DUPLICATE_MESSAGE_ID", "Message IDs must be unique"));
        }
        if !matches!(
            message.role.as_str(),
            "user" | "assistant" | "system-visible" | "tool-visible" | "unknown"
        ) {
            return Err(diag("INVALID_ROLE", "Message role is invalid"));
        }
        blocks += message.blocks.len();
        for block in &message.blocks {
            match block {
                ConversationImportBlock::Paragraph { runs }
                | ConversationImportBlock::Heading { runs, .. }
                | ConversationImportBlock::Quote { runs }
                | ConversationImportBlock::LinkParagraph { runs }
                | ConversationImportBlock::AttachmentLabel { runs } => {
                    for run in runs {
                        chars += run.text.as_deref().unwrap_or("").chars().count();
                        if let Some(href) = &run.href {
                            if !(href.starts_with("https://")
                                || href.starts_with("http://")
                                || href.starts_with("mailto:"))
                            {
                                return Err(diag("UNSAFE_LINK", "Link scheme is not allowed"));
                            }
                        }
                    }
                }
                ConversationImportBlock::List { items, .. } => {
                    for item in items {
                        for run in item {
                            chars += run.text.as_deref().unwrap_or("").chars().count();
                        }
                    }
                }
                ConversationImportBlock::Formula { formula, .. } => {
                    chars += formula.raw_source.chars().count();
                    if formula.normalized_latex.is_none() && formula.mathml.is_none() {
                        return Err(diag("INVALID_FORMULA", "Formula has no convertible source"));
                    }
                }
                ConversationImportBlock::Code { text, .. } => chars += text.chars().count(),
                ConversationImportBlock::Table {
                    rows, column_count, ..
                } => {
                    if *column_count == 0
                        || rows.iter().any(|row| row.len() != *column_count as usize)
                    {
                        return Err(diag("MALFORMED_TABLE", "Table geometry is inconsistent"));
                    }
                    cells += rows.iter().map(Vec::len).sum::<usize>();
                }
                ConversationImportBlock::HorizontalRule => {}
            }
        }
    }
    if blocks > MAX_BLOCKS || chars > MAX_TEXT_CHARS || cells > MAX_TABLE_CELLS {
        return Err(diag(
            "IMPORT_LIMIT_EXCEEDED",
            "Conversation content exceeds hard limits",
        ));
    }
    Ok(())
}

fn diag(code: &str, message: &str) -> ImportDiagnostic {
    ImportDiagnostic {
        code: code.into(),
        message: message.into(),
    }
}

pub fn compile_word_plan(record: &BrowserImportRecord) -> WordImportPlan {
    let selected: HashSet<_> = record
        .selected_message_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mut operations = Vec::new();
    let mut diagnostics = Vec::new();
    for message in record
        .document
        .messages
        .iter()
        .filter(|m| selected.contains(m.id.as_str()))
    {
        operations.push(WordImportOperation {
            kind: "message-header".into(),
            text: Some(match message.role.as_str() {
                "user" => "User".to_string(),
                "assistant" => "Assistant".to_string(),
                other => other.to_string(),
            }),
            level: None,
            ordered: None,
            rows: None,
            omml: None,
            display: None,
            style: Some("LaTeXSnipper Message Header".into()),
        });
        for block in &message.blocks {
            match block {
                ConversationImportBlock::Paragraph { runs }
                | ConversationImportBlock::LinkParagraph { runs }
                | ConversationImportBlock::AttachmentLabel { runs } => {
                    operations.push(text_op("paragraph", runs_text(runs), None))
                }
                ConversationImportBlock::Heading { level, runs } => {
                    operations.push(WordImportOperation {
                        kind: "heading".into(),
                        text: Some(runs_text(runs)),
                        level: Some(u32::from(level.unwrap_or(2).clamp(1, 6))),
                        ordered: None,
                        rows: None,
                        omml: None,
                        display: None,
                        style: Some("LaTeXSnipper Conversation Title".into()),
                    })
                }
                ConversationImportBlock::Quote { runs } => operations.push(WordImportOperation {
                    style: Some("LaTeXSnipper Quote".into()),
                    ..text_op("quote", runs_text(runs), None)
                }),
                ConversationImportBlock::Code { text, .. } => {
                    operations.push(WordImportOperation {
                        style: Some("LaTeXSnipper Code Block".into()),
                        ..text_op("code", text.clone(), None)
                    })
                }
                ConversationImportBlock::List {
                    ordered,
                    level,
                    items,
                } => {
                    for item in items {
                        operations.push(WordImportOperation {
                            kind: "list-item".into(),
                            text: Some(runs_text(item)),
                            level: Some(u32::from(*level)),
                            ordered: Some(*ordered),
                            rows: None,
                            omml: None,
                            display: None,
                            style: None,
                        });
                    }
                }
                ConversationImportBlock::Table { rows, .. } => {
                    operations.push(WordImportOperation {
                        kind: "table".into(),
                        text: None,
                        level: None,
                        ordered: None,
                        rows: Some(rows.clone()),
                        omml: None,
                        display: None,
                        style: None,
                    })
                }
                ConversationImportBlock::Formula { formula, .. } => {
                    if let Some(latex) = &formula.normalized_latex {
                        match crate::math::latex_to_omml_str(latex) {
                            Ok(omml) => operations.push(WordImportOperation {
                                kind: "formula".into(),
                                text: None,
                                level: None,
                                ordered: None,
                                rows: None,
                                omml: Some(omml),
                                display: Some(formula.display_mode != "inline"),
                                style: None,
                            }),
                            Err(error) => {
                                diagnostics.push(diag("FORMULA_CONVERSION_FAILED", &error))
                            }
                        }
                    } else {
                        diagnostics.push(diag(
                            "MATHML_CONVERSION_REQUIRED",
                            "MathML requires explicit conversion before commit",
                        ));
                    }
                }
                ConversationImportBlock::HorizontalRule => {
                    operations.push(text_op("horizontal-rule", "".into(), None))
                }
            }
        }
    }
    let checksum = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&operations).unwrap_or_default())
    );
    WordImportPlan {
        plan_id: new_uuid_v4(),
        import_id: record.document.import_id.clone(),
        operations,
        can_commit: diagnostics.is_empty(),
        diagnostics,
        checksum,
    }
}

fn text_op(kind: &str, text: String, style: Option<String>) -> WordImportOperation {
    WordImportOperation {
        kind: kind.into(),
        text: Some(text),
        level: None,
        ordered: None,
        rows: None,
        omml: None,
        display: None,
        style,
    }
}
fn runs_text(runs: &[InlineRun]) -> String {
    runs.iter()
        .filter_map(|r| r.text.as_deref())
        .collect::<Vec<_>>()
        .join("")
}

fn new_uuid_v4() -> String {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[tauri::command]
pub async fn list_browser_imports(
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<Vec<BrowserImportRecord>, String> {
    Ok(store.list().await)
}
#[tauri::command]
pub async fn get_browser_import(
    action_id: String,
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<BrowserImportRecord, String> {
    store
        .get(&action_id)
        .await
        .ok_or("Browser import not found".into())
}
#[tauri::command]
pub async fn update_browser_import_preview(
    request: BrowserImportPreviewUpdate,
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<BrowserImportRecord, String> {
    store.update_preview(request).await
}
#[tauri::command]
pub async fn build_browser_word_import_plan(
    action_id: String,
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<WordImportPlan, String> {
    let record = store
        .get(&action_id)
        .await
        .ok_or("Browser import not found")?;
    Ok(compile_word_plan(&record))
}
#[tauri::command]
pub async fn cancel_browser_import(
    action_id: String,
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<(), String> {
    store
        .set_status(&action_id, BrowserImportStatus::Cancelled, None)
        .await
}
#[tauri::command]
pub async fn complete_browser_import(
    action_id: String,
    success: bool,
    error_code: Option<String>,
    error: Option<String>,
    store: tauri::State<'_, Arc<ConversationImportStore>>,
) -> Result<(), String> {
    let diagnostic = if success {
        None
    } else {
        Some(ImportDiagnostic {
            code: error_code.unwrap_or_else(|| "WORD_IMPORT_FAILED".into()),
            message: error.unwrap_or_else(|| "Word import failed".into()),
        })
    };
    store
        .set_status(
            &action_id,
            if success {
                BrowserImportStatus::Completed
            } else {
                BrowserImportStatus::Failed
            },
            diagnostic,
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> ConversationImportDocument {
        serde_json::from_value(serde_json::json!({"schemaVersion":1,"importId":"import-1","provider":"chatgpt","providerAdapterVersion":"1.0.0","sourceUrl":"https://chatgpt.com/c/fixture","extractedAt":"2026-01-01T00:00:00Z","scope":{"explicitUserConfirmation":true},"messages":[{"id":"u1","role":"user","sequence":0,"blocks":[{"type":"paragraph","runs":[{"type":"text","text":"请解释"}]}]},{"id":"a1","role":"assistant","sequence":1,"blocks":[{"type":"formula","formula":{"id":"f1","rawSource":"$x^2$","normalizedLatex":"x^2","displayMode":"inline","source":"tex-delimiter","renderer":"plain-text","confidence":0.9,"pageUrl":"https://chatgpt.com"}}]}],"truncated":false,"diagnostics":[]})).unwrap()
    }
    #[test]
    fn multilingual_ast_validates_and_plans_omml() {
        let document = sample();
        validate_document(&document).unwrap();
        let record = BrowserImportRecord {
            action_id: "a".into(),
            received_at: "now".into(),
            status: BrowserImportStatus::AwaitingPreview,
            source_browser: "chrome".into(),
            selected_message_ids: vec!["u1".into(), "a1".into()],
            import_mode: "question-and-answer".into(),
            template: "clean-notes".into(),
            formula_numbering: "none".into(),
            destination_session_id: None,
            expected_document_id: None,
            last_error: None,
            document,
        };
        let plan = compile_word_plan(&record);
        assert!(plan.can_commit);
        assert!(plan.operations.iter().any(|op| op.omml.is_some()));
    }
    #[test]
    fn duplicate_ids_are_rejected() {
        let mut d = sample();
        d.messages[1].id = "u1".into();
        assert_eq!(
            validate_document(&d).unwrap_err().code,
            "DUPLICATE_MESSAGE_ID"
        );
    }
    #[test]
    fn unsafe_link_is_rejected() {
        let mut d = sample();
        if let ConversationImportBlock::Paragraph { runs } = &mut d.messages[0].blocks[0] {
            runs[0].href = Some("javascript:alert(1)".into());
        }
        assert_eq!(validate_document(&d).unwrap_err().code, "UNSAFE_LINK");
    }

    #[tokio::test]
    async fn persisted_import_survives_restart_and_update() {
        let root = std::env::temp_dir().join(format!("latexsnipper-import-test-{}", new_uuid_v4()));
        let store = ConversationImportStore::new_with_root(root.clone()).unwrap();
        store
            .receive("action-1".into(), "chrome".into(), sample())
            .await
            .unwrap();
        store
            .set_status("action-1", BrowserImportStatus::Completed, None)
            .await
            .unwrap();
        drop(store);

        let reloaded = ConversationImportStore::new_with_root(root.clone()).unwrap();
        let record = reloaded.get("action-1").await.unwrap();
        assert_eq!(record.status, BrowserImportStatus::Completed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
