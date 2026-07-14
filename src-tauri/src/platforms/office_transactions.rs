use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub const OFFICE_EDIT_TRANSACTION_PROTOCOL_VERSION: u32 = 1;
pub const OFFICE_EDIT_TRANSACTION_TTL_MS: u64 = 2 * 60 * 60 * 1000;
pub const OFFICE_EDIT_COMPLETED_RETENTION_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_TRANSACTION_FILE_BYTES: u64 = 256 * 1024;
const MAX_DRAFT_LATEX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OfficeIntegrationKind {
    NativeOffice,
    OfficeJs,
    WpsJs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OfficeHostKind {
    Word,
    Excel,
    PowerPoint,
    WpsWriter,
    WpsSpreadsheets,
    WpsPresentation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OfficeEditAction {
    Insert,
    Update,
    Delete,
    Read,
    InsertReference,
    Renumber,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FormulaInsertMode {
    Inline,
    Display,
    Numbered,
}

impl FormulaInsertMode {
    pub fn from_protocol(value: Option<&str>) -> Self {
        match value.unwrap_or("inline") {
            "numbered" | "displayNumbered" => Self::Numbered,
            "display" | "block" => Self::Display,
            _ => Self::Inline,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EquationNumberingScheme {
    Global,
    ChapterDot,
    ChapterHyphen,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EquationNumberingOptions {
    pub scheme: EquationNumberingScheme,
    pub chapter_level: Option<u8>,
    pub separator: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaMetadataEnvelope {
    pub schema: String,
    pub schema_version: u32,
    pub formula_id: String,
    pub revision: u64,
    pub latex: String,
    pub display_mode: FormulaInsertMode,
    pub numbering: Option<EquationNumberingOptions>,
    pub renderer: String,
    pub created_with_version: String,
    pub updated_with_version: String,
    pub created_at: String,
    pub updated_at: String,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedFormulaAsset {
    pub asset_id: String,
    pub format: String,
    pub width_pt: f64,
    pub height_pt: f64,
    pub byte_len: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredOfficeError {
    pub error_code: String,
    pub operation: String,
    pub host: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OfficeEditTransactionState {
    Opened,
    Editing,
    Rendering,
    Prepared,
    Committing,
    Completed,
    Cancelled,
    Failed,
    Stale,
}

impl OfficeEditTransactionState {
    fn owns_target(&self) -> bool {
        matches!(
            self,
            Self::Opened | Self::Editing | Self::Rendering | Self::Prepared | Self::Committing
        )
    }

    fn recoverable(&self) -> bool {
        self.owns_target() || matches!(self, Self::Failed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeEditTransaction {
    pub transaction_id: String,
    pub protocol_version: u32,
    pub integration: OfficeIntegrationKind,
    pub host: OfficeHostKind,
    pub source_session_id: Option<String>,
    pub source_document_id: Option<String>,
    pub source_object_id: Option<String>,
    pub formula_id: String,
    pub action: OfficeEditAction,
    pub requested_mode: FormulaInsertMode,
    pub numbering: Option<EquationNumberingOptions>,
    pub original_revision: Option<u64>,
    pub original_metadata: Option<FormulaMetadataEnvelope>,
    pub draft_latex: String,
    pub rendered_asset: Option<RenderedFormulaAsset>,
    pub state: OfficeEditTransactionState,
    pub error: Option<StructuredOfficeError>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginOfficeEditTransactionRequest {
    pub integration: OfficeIntegrationKind,
    pub host: OfficeHostKind,
    pub source_session_id: Option<String>,
    pub source_document_id: Option<String>,
    pub source_object_id: Option<String>,
    pub formula_id: Option<String>,
    pub action: OfficeEditAction,
    pub requested_mode: FormulaInsertMode,
    pub numbering: Option<EquationNumberingOptions>,
    pub original_revision: Option<u64>,
    pub original_metadata: Option<FormulaMetadataEnvelope>,
    #[serde(default)]
    pub draft_latex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOfficeEditDraftRequest {
    pub transaction_id: String,
    pub draft_latex: String,
    pub requested_mode: FormulaInsertMode,
    pub numbering: Option<EquationNumberingOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOfficeEditCommitRequest {
    pub transaction_id: String,
    pub draft_latex: String,
    pub requested_mode: FormulaInsertMode,
    pub numbering: Option<EquationNumberingOptions>,
    pub rendered_asset: Option<RenderedFormulaAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteOfficeEditTransactionRequest {
    pub transaction_id: String,
    pub success: bool,
    pub error: Option<StructuredOfficeError>,
}

pub struct OfficeEditTransactionStore {
    root: PathBuf,
    transactions: Mutex<HashMap<String, OfficeEditTransaction>>,
}

impl OfficeEditTransactionStore {
    pub fn new() -> Result<Self, String> {
        Self::new_at(
            dirs_next::data_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("LaTeXSnipper")
                .join("office-edit-transactions"),
        )
    }

    fn new_at(root: PathBuf) -> Result<Self, String> {
        create_private_directory(&root)?;
        create_private_directory(&root.join("quarantine"))?;
        let now = now_ms();
        let mut transactions = HashMap::new();
        let entries = fs::read_dir(&root).map_err(|error| error.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let loaded = fs::metadata(&path)
                .map_err(|error| error.to_string())
                .and_then(|metadata| {
                    if metadata.len() > MAX_TRANSACTION_FILE_BYTES {
                        Err("transaction file exceeds the size limit".to_string())
                    } else {
                        fs::read(&path).map_err(|error| error.to_string())
                    }
                })
                .and_then(|bytes| {
                    serde_json::from_slice::<OfficeEditTransaction>(&bytes)
                        .map_err(|error| error.to_string())
                })
                .and_then(|transaction| {
                    validate_transaction(&transaction)?;
                    Ok(transaction)
                });
            match loaded {
                Ok(transaction)
                    if !should_remove_transaction(&transaction, now)
                        && transaction.protocol_version
                            == OFFICE_EDIT_TRANSACTION_PROTOCOL_VERSION =>
                {
                    transactions.insert(transaction.transaction_id.clone(), transaction);
                }
                Ok(_) => {
                    let _ = fs::remove_file(&path);
                }
                Err(error) => {
                    log::warn!(
                        "[OfficeTransaction] quarantining corrupt file {}: {}",
                        path.display(),
                        error
                    );
                    quarantine_file(&root, &path);
                }
            }
        }
        Ok(Self {
            root,
            transactions: Mutex::new(transactions),
        })
    }

    pub async fn begin(
        &self,
        request: BeginOfficeEditTransactionRequest,
    ) -> Result<OfficeEditTransaction, String> {
        validate_draft(&request.draft_latex)?;
        validate_numbering(request.requested_mode.clone(), request.numbering.as_ref())?;
        let now = now_ms();
        let mut transactions = self.transactions.lock().await;
        self.cleanup_locked(&mut transactions, now)?;
        let formula_id = request.formula_id.unwrap_or_else(new_uuid_v4);
        let target_key = transaction_target_key(
            &request.integration,
            &request.host,
            request.source_document_id.as_deref(),
            request.source_object_id.as_deref(),
            &formula_id,
        );
        if transactions
            .values()
            .any(|existing| existing.state.owns_target() && transaction_key(existing) == target_key)
        {
            return Err("OFFICE_TRANSACTION_CONFLICT: target already has an active edit".into());
        }
        let transaction = OfficeEditTransaction {
            transaction_id: new_uuid_v4(),
            protocol_version: OFFICE_EDIT_TRANSACTION_PROTOCOL_VERSION,
            integration: request.integration,
            host: request.host,
            source_session_id: request.source_session_id,
            source_document_id: request.source_document_id,
            source_object_id: request.source_object_id,
            formula_id,
            action: request.action,
            requested_mode: request.requested_mode,
            numbering: request.numbering,
            original_revision: request.original_revision,
            original_metadata: request.original_metadata,
            draft_latex: request.draft_latex,
            rendered_asset: None,
            state: OfficeEditTransactionState::Opened,
            error: None,
            created_at_ms: now,
            updated_at_ms: now,
            expires_at_ms: now.saturating_add(OFFICE_EDIT_TRANSACTION_TTL_MS),
        };
        self.persist(&transaction)?;
        transactions.insert(transaction.transaction_id.clone(), transaction.clone());
        Ok(transaction)
    }

    pub async fn get(&self, transaction_id: &str) -> Result<OfficeEditTransaction, String> {
        let transactions = self.transactions.lock().await;
        transactions
            .get(transaction_id)
            .cloned()
            .ok_or_else(|| "OFFICE_TRANSACTION_NOT_FOUND".to_string())
    }

    pub async fn update_draft(
        &self,
        request: UpdateOfficeEditDraftRequest,
    ) -> Result<OfficeEditTransaction, String> {
        validate_draft(&request.draft_latex)?;
        validate_numbering(request.requested_mode.clone(), request.numbering.as_ref())?;
        self.update(&request.transaction_id, |transaction, now| {
            if !transaction.state.recoverable() {
                return Err("OFFICE_TRANSACTION_STATE_INVALID".into());
            }
            transaction.draft_latex = request.draft_latex;
            transaction.requested_mode = request.requested_mode;
            transaction.numbering = request.numbering;
            transaction.state = OfficeEditTransactionState::Editing;
            transaction.error = None;
            transaction.updated_at_ms = now;
            transaction.expires_at_ms = now.saturating_add(OFFICE_EDIT_TRANSACTION_TTL_MS);
            Ok(())
        })
        .await
    }

    pub async fn prepare(
        &self,
        request: PrepareOfficeEditCommitRequest,
    ) -> Result<OfficeEditTransaction, String> {
        validate_draft(&request.draft_latex)?;
        validate_numbering(request.requested_mode.clone(), request.numbering.as_ref())?;
        if let Some(asset) = request.rendered_asset.as_ref() {
            validate_rendered_asset(asset)?;
        }
        self.update(&request.transaction_id, |transaction, now| {
            if !transaction.state.recoverable() {
                return Err("OFFICE_TRANSACTION_STATE_INVALID".into());
            }
            transaction.draft_latex = request.draft_latex;
            transaction.requested_mode = request.requested_mode;
            transaction.numbering = request.numbering;
            transaction.rendered_asset = request.rendered_asset;
            transaction.state = OfficeEditTransactionState::Prepared;
            transaction.error = None;
            transaction.updated_at_ms = now;
            transaction.expires_at_ms = now.saturating_add(OFFICE_EDIT_TRANSACTION_TTL_MS);
            Ok(())
        })
        .await
    }

    pub async fn mark_committing(
        &self,
        transaction_id: &str,
    ) -> Result<OfficeEditTransaction, String> {
        self.update(transaction_id, |transaction, now| {
            if transaction.state != OfficeEditTransactionState::Prepared {
                return Err("OFFICE_TRANSACTION_NOT_PREPARED".into());
            }
            transaction.state = OfficeEditTransactionState::Committing;
            transaction.updated_at_ms = now;
            Ok(())
        })
        .await
    }

    pub async fn complete(
        &self,
        request: CompleteOfficeEditTransactionRequest,
    ) -> Result<OfficeEditTransaction, String> {
        self.update(&request.transaction_id, |transaction, now| {
            if !matches!(
                transaction.state,
                OfficeEditTransactionState::Prepared
                    | OfficeEditTransactionState::Committing
                    | OfficeEditTransactionState::Failed
            ) {
                return Err("OFFICE_TRANSACTION_STATE_INVALID".into());
            }
            transaction.state = if request.success {
                OfficeEditTransactionState::Completed
            } else {
                OfficeEditTransactionState::Failed
            };
            transaction.error = request.error;
            transaction.updated_at_ms = now;
            transaction.expires_at_ms = if request.success {
                now.saturating_add(OFFICE_EDIT_COMPLETED_RETENTION_MS)
            } else {
                now.saturating_add(OFFICE_EDIT_TRANSACTION_TTL_MS)
            };
            Ok(())
        })
        .await
    }

    pub async fn cancel(&self, transaction_id: &str) -> Result<OfficeEditTransaction, String> {
        self.update(transaction_id, |transaction, now| {
            if !transaction.state.recoverable() {
                return Err("OFFICE_TRANSACTION_STATE_INVALID".into());
            }
            transaction.state = OfficeEditTransactionState::Cancelled;
            transaction.updated_at_ms = now;
            transaction.expires_at_ms = now.saturating_add(OFFICE_EDIT_COMPLETED_RETENTION_MS);
            Ok(())
        })
        .await
    }

    pub async fn list_recoverable(&self) -> Result<Vec<OfficeEditTransaction>, String> {
        let now = now_ms();
        let mut transactions = self.transactions.lock().await;
        self.cleanup_locked(&mut transactions, now)?;
        let mut result = transactions
            .values()
            .filter(|transaction| transaction.state.recoverable())
            .cloned()
            .collect::<Vec<_>>();
        result.sort_by_key(|transaction| std::cmp::Reverse(transaction.updated_at_ms));
        Ok(result)
    }

    pub async fn discard(&self, transaction_id: &str) -> Result<(), String> {
        let mut transactions = self.transactions.lock().await;
        transactions
            .remove(transaction_id)
            .ok_or_else(|| "OFFICE_TRANSACTION_NOT_FOUND".to_string())?;
        let path = self.transaction_path(transaction_id);
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    async fn update<F>(
        &self,
        transaction_id: &str,
        change: F,
    ) -> Result<OfficeEditTransaction, String>
    where
        F: FnOnce(&mut OfficeEditTransaction, u64) -> Result<(), String>,
    {
        let mut transactions = self.transactions.lock().await;
        let transaction = transactions
            .get_mut(transaction_id)
            .ok_or_else(|| "OFFICE_TRANSACTION_NOT_FOUND".to_string())?;
        if transaction.expires_at_ms <= now_ms() {
            return Err("OFFICE_TRANSACTION_EXPIRED".to_string());
        }
        change(transaction, now_ms())?;
        validate_transaction(transaction)?;
        self.persist(transaction)?;
        Ok(transaction.clone())
    }

    fn cleanup_locked(
        &self,
        transactions: &mut HashMap<String, OfficeEditTransaction>,
        now: u64,
    ) -> Result<(), String> {
        let stale_ids = transactions
            .iter()
            .filter_map(|(id, transaction)| {
                should_remove_transaction(transaction, now).then_some(id.clone())
            })
            .collect::<Vec<_>>();
        for id in stale_ids {
            transactions.remove(&id);
            let path = self.transaction_path(&id);
            if path.exists() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn persist(&self, transaction: &OfficeEditTransaction) -> Result<(), String> {
        validate_transaction(transaction)?;
        let json = serde_json::to_vec_pretty(transaction).map_err(|error| error.to_string())?;
        if json.len() as u64 > MAX_TRANSACTION_FILE_BYTES {
            return Err("OFFICE_TRANSACTION_TOO_LARGE".to_string());
        }
        let destination = self.transaction_path(&transaction.transaction_id);
        let temporary = self.root.join(format!(
            ".{}.{}.tmp",
            transaction.transaction_id,
            new_uuid_v4()
        ));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        set_private_file_permissions(&temporary)?;
        file.write_all(&json).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if let Err(error) = replace_file_atomically(&temporary, &destination) {
            let _ = fs::remove_file(&temporary);
            return Err(error.to_string());
        }
        Ok(())
    }

    fn transaction_path(&self, transaction_id: &str) -> PathBuf {
        self.root.join(format!("{transaction_id}.json"))
    }
}

#[tauri::command]
pub async fn begin_office_edit_transaction(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    request: BeginOfficeEditTransactionRequest,
) -> Result<OfficeEditTransaction, String> {
    state.begin(request).await
}

#[tauri::command]
pub async fn get_office_edit_transaction(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    transaction_id: String,
) -> Result<OfficeEditTransaction, String> {
    state.get(&transaction_id).await
}

#[tauri::command]
pub async fn update_office_edit_draft(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    request: UpdateOfficeEditDraftRequest,
) -> Result<OfficeEditTransaction, String> {
    state.update_draft(request).await
}

#[tauri::command]
pub async fn prepare_office_edit_commit(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    request: PrepareOfficeEditCommitRequest,
) -> Result<OfficeEditTransaction, String> {
    state.prepare(request).await
}

#[tauri::command]
pub async fn mark_office_edit_committing(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    transaction_id: String,
) -> Result<OfficeEditTransaction, String> {
    state.mark_committing(&transaction_id).await
}

#[tauri::command]
pub async fn complete_office_edit_transaction(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    request: CompleteOfficeEditTransactionRequest,
) -> Result<OfficeEditTransaction, String> {
    state.complete(request).await
}

#[tauri::command]
pub async fn cancel_office_edit_transaction(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    transaction_id: String,
) -> Result<OfficeEditTransaction, String> {
    state.cancel(&transaction_id).await
}

#[tauri::command]
pub async fn list_recoverable_office_transactions(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
) -> Result<Vec<OfficeEditTransaction>, String> {
    state.list_recoverable().await
}

#[tauri::command]
pub async fn discard_stale_office_transaction(
    state: State<'_, Arc<OfficeEditTransactionStore>>,
    transaction_id: String,
) -> Result<(), String> {
    state.discard(&transaction_id).await
}

fn validate_transaction(transaction: &OfficeEditTransaction) -> Result<(), String> {
    if transaction.protocol_version != OFFICE_EDIT_TRANSACTION_PROTOCOL_VERSION {
        return Err("unsupported transaction protocol version".to_string());
    }
    if !is_uuid(&transaction.transaction_id) || !is_formula_id(&transaction.formula_id) {
        return Err("transaction and formula identifiers must be UUIDs".to_string());
    }
    validate_draft(&transaction.draft_latex)?;
    validate_numbering(
        transaction.requested_mode.clone(),
        transaction.numbering.as_ref(),
    )?;
    if transaction.created_at_ms > transaction.updated_at_ms
        || transaction.updated_at_ms > transaction.expires_at_ms
    {
        return Err("invalid transaction timestamps".to_string());
    }
    if let Some(asset) = transaction.rendered_asset.as_ref() {
        validate_rendered_asset(asset)?;
    }
    Ok(())
}

fn validate_draft(draft: &str) -> Result<(), String> {
    if draft.len() > MAX_DRAFT_LATEX_BYTES {
        return Err("OFFICE_TRANSACTION_DRAFT_TOO_LARGE".to_string());
    }
    Ok(())
}

fn validate_numbering(
    mode: FormulaInsertMode,
    numbering: Option<&EquationNumberingOptions>,
) -> Result<(), String> {
    if numbering.is_some() && mode != FormulaInsertMode::Numbered {
        return Err("numbering options require numbered mode".to_string());
    }
    if let Some(numbering) = numbering {
        if numbering
            .chapter_level
            .is_some_and(|level| level == 0 || level > 9)
        {
            return Err("invalid numbering chapter level".to_string());
        }
        if numbering
            .separator
            .as_ref()
            .is_some_and(|value| value.len() > 8)
            || numbering
                .label
                .as_ref()
                .is_some_and(|value| value.len() > 128)
        {
            return Err("numbering options exceed size limits".to_string());
        }
    }
    Ok(())
}

fn validate_rendered_asset(asset: &RenderedFormulaAsset) -> Result<(), String> {
    if !is_uuid(&asset.asset_id)
        || !matches!(asset.format.as_str(), "svg" | "png" | "emf")
        || !asset.width_pt.is_finite()
        || asset.width_pt <= 0.0
        || !asset.height_pt.is_finite()
        || asset.height_pt <= 0.0
        || asset.byte_len == 0
        || asset.sha256.len() != 64
        || !asset.sha256.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err("invalid rendered asset reference".to_string());
    }
    Ok(())
}

fn transaction_key(transaction: &OfficeEditTransaction) -> String {
    transaction_target_key(
        &transaction.integration,
        &transaction.host,
        transaction.source_document_id.as_deref(),
        transaction.source_object_id.as_deref(),
        &transaction.formula_id,
    )
}

fn transaction_target_key(
    integration: &OfficeIntegrationKind,
    host: &OfficeHostKind,
    document_id: Option<&str>,
    object_id: Option<&str>,
    formula_id: &str,
) -> String {
    format!(
        "{:?}|{:?}|{}|{}",
        integration,
        host,
        document_id.unwrap_or(""),
        object_id.unwrap_or(formula_id)
    )
}

fn should_remove_transaction(transaction: &OfficeEditTransaction, now: u64) -> bool {
    transaction.expires_at_ms <= now
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn quarantine_file(root: &Path, path: &Path) {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("corrupt.json");
    let destination = root
        .join("quarantine")
        .join(format!("{}.{}.corrupt", now_ms(), name));
    if fs::rename(path, &destination).is_err() {
        let _ = fs::remove_file(path);
    }
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

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

fn is_formula_id(value: &str) -> bool {
    is_uuid(value) || (value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(std::io::Error::from)
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("latexsnipper-transaction-{name}-{}", new_uuid_v4()))
    }

    fn begin_request(mode: FormulaInsertMode) -> BeginOfficeEditTransactionRequest {
        BeginOfficeEditTransactionRequest {
            integration: OfficeIntegrationKind::NativeOffice,
            host: OfficeHostKind::Word,
            source_session_id: Some("session-1".into()),
            source_document_id: Some("document-1".into()),
            source_object_id: None,
            formula_id: None,
            action: OfficeEditAction::Insert,
            requested_mode: mode,
            numbering: None,
            original_revision: None,
            original_metadata: None,
            draft_latex: "x^2".into(),
        }
    }

    #[tokio::test]
    async fn numbered_mode_survives_restart() {
        let root = test_root("numbered");
        let transaction = {
            let store = OfficeEditTransactionStore::new_at(root.clone()).unwrap();
            store
                .begin(begin_request(FormulaInsertMode::Numbered))
                .await
                .unwrap()
        };
        let reopened = OfficeEditTransactionStore::new_at(root.clone()).unwrap();
        let recovered = reopened.get(&transaction.transaction_id).await.unwrap();
        assert_eq!(recovered.requested_mode, FormulaInsertMode::Numbered);
        assert_eq!(recovered.source_document_id.as_deref(), Some("document-1"));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn duplicate_target_is_rejected() {
        let root = test_root("conflict");
        let store = OfficeEditTransactionStore::new_at(root.clone()).unwrap();
        let formula_id = new_uuid_v4();
        let mut first = begin_request(FormulaInsertMode::Inline);
        first.action = OfficeEditAction::Update;
        first.source_object_id = Some(formula_id.clone());
        first.formula_id = Some(formula_id.clone());
        store.begin(first).await.unwrap();
        let mut second = begin_request(FormulaInsertMode::Display);
        second.action = OfficeEditAction::Update;
        second.source_object_id = Some(formula_id.clone());
        second.formula_id = Some(formula_id);
        let error = store.begin(second).await.unwrap_err();
        assert!(error.contains("OFFICE_TRANSACTION_CONFLICT"));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn corrupt_transaction_is_quarantined() {
        let root = test_root("corrupt");
        create_private_directory(&root).unwrap();
        fs::write(root.join("bad.json"), b"{not-json").unwrap();
        let store = OfficeEditTransactionStore::new_at(root.clone()).unwrap();
        assert!(store.list_recoverable().await.unwrap().is_empty());
        assert!(fs::read_dir(root.join("quarantine"))
            .unwrap()
            .next()
            .is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn failed_commit_keeps_transaction_recoverable() {
        let root = test_root("failed");
        let store = OfficeEditTransactionStore::new_at(root.clone()).unwrap();
        let transaction = store
            .begin(begin_request(FormulaInsertMode::Inline))
            .await
            .unwrap();
        store
            .prepare(PrepareOfficeEditCommitRequest {
                transaction_id: transaction.transaction_id.clone(),
                draft_latex: "x^3".into(),
                requested_mode: FormulaInsertMode::Inline,
                numbering: None,
                rendered_asset: None,
            })
            .await
            .unwrap();
        store
            .mark_committing(&transaction.transaction_id)
            .await
            .unwrap();
        store
            .complete(CompleteOfficeEditTransactionRequest {
                transaction_id: transaction.transaction_id.clone(),
                success: false,
                error: Some(StructuredOfficeError {
                    error_code: "HOST_COMMIT_FAILED".into(),
                    operation: "insert".into(),
                    host: "word".into(),
                    message: "injected failure".into(),
                }),
            })
            .await
            .unwrap();
        assert_eq!(store.list_recoverable().await.unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn six_hosts_serialize_round_trip() {
        for host in [
            OfficeHostKind::Word,
            OfficeHostKind::Excel,
            OfficeHostKind::PowerPoint,
            OfficeHostKind::WpsWriter,
            OfficeHostKind::WpsSpreadsheets,
            OfficeHostKind::WpsPresentation,
        ] {
            let value = serde_json::to_string(&host).unwrap();
            let round_trip: OfficeHostKind = serde_json::from_str(&value).unwrap();
            assert_eq!(host, round_trip);
        }
    }
}
