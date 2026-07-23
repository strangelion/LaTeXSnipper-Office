//! Named Pipe protocol definitions for LaTeXSnipper Native Office v3.
//!
//! All messages use length-prefixed UTF-8 JSON framing:
//!   [4 bytes LE payload length] [UTF-8 JSON payload]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PROTOCOL_VERSION: u32 = 3;
pub const PIPE_PREFIX: &str = "LaTeXSnipper.NativeOffice.v3";
#[allow(
    dead_code,
    reason = "Shared constant consumed by non-Rust protocol clients"
)]
pub const CUSTOM_XML_NAMESPACE: &str = "urn:latexsnipper:office:objects:v3";

// ---------------------------------------------------------------------------
// VSTO -> Desktop messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(
    non_snake_case,
    clippy::large_enum_variant,
    reason = "Field names and enum layout are fixed by the VSTO wire protocol"
)]
pub enum VstoMessage {
    #[serde(rename = "HELLO")]
    Hello {
        requestId: String,
        sessionId: String,
        #[serde(rename = "protocolVersion")]
        protocolVersion: u32,
        #[serde(rename = "dpapiSecret")]
        dpapiSecret: String,
        #[serde(rename = "hostType")]
        hostType: String, // "word" | "excel" | "powerpoint"
        #[serde(rename = "hostVersion")]
        hostVersion: String,
        #[serde(rename = "windowHandle", skip_serializing_if = "Option::is_none")]
        windowHandle: Option<u64>,
    },

    #[serde(rename = "HOST_READY")]
    HostReady {
        requestId: String,
        sessionId: String,
        #[serde(rename = "hostType")]
        hostType: String,
        #[serde(rename = "hostVersion")]
        hostVersion: String,
        #[serde(rename = "hostPid", skip_serializing_if = "Option::is_none")]
        hostPid: Option<u32>,
        #[serde(rename = "documentContextId", skip_serializing_if = "Option::is_none")]
        documentContextId: Option<String>,
        #[serde(rename = "documentTitle", skip_serializing_if = "Option::is_none")]
        documentTitle: Option<String>,
        #[serde(rename = "documentKind", skip_serializing_if = "Option::is_none")]
        documentKind: Option<String>,
        #[serde(rename = "capabilities", skip_serializing_if = "Option::is_none")]
        capabilities: Option<Capabilities>,
    },

    #[serde(rename = "VSTO_CONTEXT_CHANGED")]
    VstoContextChanged {
        requestId: String,
        sessionId: String,
        #[serde(rename = "documentContextId")]
        documentContextId: String,
        #[serde(rename = "documentTitle", skip_serializing_if = "Option::is_none")]
        documentTitle: Option<String>,
        #[serde(rename = "documentKind", skip_serializing_if = "Option::is_none")]
        documentKind: Option<String>,
    },

    #[serde(rename = "OPEN_EDITOR")]
    OpenEditor {
        requestId: String,
        sessionId: String,
        #[serde(default)]
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        display: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        omml: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        latex: Option<String>,
        #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
        formulaId: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<u64>,
        #[serde(rename = "sourceHost", skip_serializing_if = "Option::is_none")]
        sourceHost: Option<String>,
    },

    #[serde(rename = "FOCUS_OCR")]
    FocusOcr {
        requestId: String,
        sessionId: String,
    },

    #[serde(rename = "FOCUS_SETTINGS")]
    FocusSettings {
        requestId: String,
        sessionId: String,
    },

    #[serde(rename = "READ_SELECTION")]
    ReadSelection {
        requestId: String,
        sessionId: String,
        #[serde(rename = "formula", skip_serializing_if = "Option::is_none")]
        formula: Option<FormulaPayload>,
        #[serde(rename = "rangeXml", skip_serializing_if = "Option::is_none")]
        rangeXml: Option<String>,
    },

    #[serde(rename = "FORMULA_SNAPSHOT")]
    FormulaSnapshot {
        requestId: String,
        sessionId: String,
        #[serde(rename = "formula", skip_serializing_if = "Option::is_none")]
        formula: Option<FormulaPayload>,
        #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
        errorCode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "READ_TABLE")]
    ReadTable {
        requestId: String,
        sessionId: String,
        #[serde(rename = "table", skip_serializing_if = "Option::is_none")]
        table: Option<TablePayload>,
        #[serde(rename = "tableXml", skip_serializing_if = "Option::is_none")]
        tableXml: Option<String>,
    },

    #[serde(rename = "INSERT_TABLE_RESULT")]
    InsertTableResult {
        requestId: String,
        sessionId: String,
        success: bool,
        #[serde(rename = "tableId", skip_serializing_if = "Option::is_none")]
        tableId: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "INSERT_RESULT")]
    InsertResult {
        requestId: String,
        sessionId: String,
        success: bool,
        #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
        formulaId: Option<String>,
        #[serde(rename = "rangeStart", skip_serializing_if = "Option::is_none")]
        rangeStart: Option<u32>,
        #[serde(rename = "rangeEnd", skip_serializing_if = "Option::is_none")]
        rangeEnd: Option<u32>,
        #[serde(
            rename = "requestedStorageMode",
            skip_serializing_if = "Option::is_none"
        )]
        requestedStorageMode: Option<String>,
        #[serde(rename = "actualStorageMode", skip_serializing_if = "Option::is_none")]
        actualStorageMode: Option<String>,
        #[serde(rename = "fallbackReason", skip_serializing_if = "Option::is_none")]
        fallbackReason: Option<String>,
        #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
        errorCode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "CONVERSATION_IMPORT_RESULT")]
    ConversationImportResult {
        requestId: String,
        sessionId: String,
        #[serde(rename = "importId")]
        importId: String,
        success: bool,
        #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
        errorCode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "REPLACE_RESULT")]
    ReplaceResult {
        requestId: String,
        sessionId: String,
        success: bool,
        #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
        formulaId: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<u64>,
        #[serde(rename = "actualStorageMode", skip_serializing_if = "Option::is_none")]
        actualStorageMode: Option<String>,
        #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
        errorCode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "DELETE_RESULT")]
    DeleteResult {
        requestId: String,
        sessionId: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "HOST_ERROR")]
    HostError {
        requestId: String,
        sessionId: String,
        error: String,
        #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
        errorCode: Option<String>,
    },

    #[serde(rename = "SCAN_LATEX_RESULT")]
    ScanLatexResult {
        requestId: String,
        sessionId: String,
        scope: String,
        candidates: Vec<LatexCandidateWire>,
    },

    #[serde(rename = "BATCH_CONVERT_RESULT")]
    BatchConvertResult {
        requestId: String,
        sessionId: String,
        #[serde(rename = "planId")]
        plan_id: String,
        total: usize,
        converted: usize,
        skipped: usize,
        failed: usize,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        failures: Vec<BatchFailureWire>,
    },
}

// ---------------------------------------------------------------------------
// Desktop -> VSTO messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(
    non_snake_case,
    reason = "Field names are fixed by the VSTO wire protocol"
)]
pub enum DesktopMessage {
    #[serde(rename = "HELLO_ACK")]
    HelloAck {
        requestId: String,
        sessionId: String,
        #[serde(rename = "protocolVersion")]
        protocolVersion: u32,
    },

    #[serde(rename = "HELLO_NACK")]
    HelloNack {
        requestId: String,
        sessionId: String,
        #[serde(rename = "errorCode")]
        errorCode: String,
        error: String,
    },

    #[serde(rename = "PING")]
    Ping {
        requestId: String,
        sessionId: String,
    },

    #[serde(rename = "INSERT_FORMULA")]
    InsertFormula {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        formula: FormulaPayload,
        mode: InsertMode,
        #[serde(rename = "integrationMode", skip_serializing_if = "Option::is_none")]
        integration_mode: Option<FormulaIntegrationMode>,
    },

    #[serde(rename = "REPLACE_FORMULA")]
    ReplaceFormula {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(rename = "formulaId")]
        formulaId: String,
        formula: FormulaPayload,
    },

    #[serde(rename = "INSERT_TABLE")]
    InsertTable {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        table: TablePayload,
    },

    #[serde(rename = "IMPORT_CONVERSATION")]
    ImportConversation {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId")]
        expectedContextId: String,
        plan: super::conversation_import::WordImportPlan,
    },

    #[serde(rename = "REQUEST_READ_SELECTION")]
    RequestReadSelection {
        requestId: String,
        sessionId: String,
    },

    #[serde(rename = "REQUEST_READ_FORMULA")]
    RequestReadFormula {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(rename = "formulaId")]
        formulaId: String,
    },

    #[serde(rename = "REQUEST_READ_TABLE")]
    RequestReadTable {
        requestId: String,
        sessionId: String,
    },

    #[serde(rename = "DELETE_CURRENT")]
    DeleteCurrent {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
        formulaId: Option<String>,
    },

    #[serde(rename = "FORMAT_SELECTION")]
    FormatSelection {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        options: FormatOptions,
    },

    #[serde(rename = "FORMAT_ALL")]
    FormatAll {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        options: FormatOptions,
    },

    #[serde(rename = "RENUMBER_WORD")]
    RenumberWord {
        requestId: String,
        sessionId: String,
        #[serde(rename = "startFrom", skip_serializing_if = "Option::is_none")]
        startFrom: Option<u32>,
    },

    #[serde(rename = "INSERT_WORD_REFERENCE")]
    InsertWordReference {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(rename = "formulaId")]
        formulaId: String,
        #[serde(rename = "referenceType")]
        referenceType: String,
    },

    #[serde(rename = "CONVERT_FORMULA")]
    ConvertFormula {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(rename = "formulaId")]
        formulaId: String,
        #[serde(rename = "targetMode")]
        targetMode: String,
    },

    /// Request the VSTO host to scan the document for LaTeX candidates.
    /// Scope: "selection", "currentSlide", "selectedSlides", "entireDocument"
    #[serde(rename = "SCAN_LATEX")]
    ScanLatex {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId", skip_serializing_if = "Option::is_none")]
        expectedContextId: Option<String>,
        #[serde(default = "default_scan_scope")]
        scope: String,
    },

    /// Execute a batch of OMML replacements on the VSTO host.
    #[serde(rename = "BATCH_CONVERT")]
    BatchConvert {
        requestId: String,
        sessionId: String,
        #[serde(rename = "expectedContextId")]
        expectedContextId: String,
        #[serde(rename = "planId")]
        planId: String,
        /// JSON-serialized BatchConversionPlan
        plan: serde_json::Value,
    },
}

/// Capabilities of a VSTO host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    #[serde(rename = "insertFormula")]
    pub insert_formula: bool,
    #[serde(rename = "replaceFormula")]
    pub replace_formula: bool,
    #[serde(rename = "readSelection")]
    pub read_selection: bool,
    #[serde(rename = "insertTable")]
    pub insert_table: bool,
    #[serde(rename = "readTable")]
    pub read_table: bool,
    #[serde(rename = "requiresSvgForFormula")]
    pub requires_svg_for_formula: bool,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub features: HashMap<String, bool>,
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaPayload {
    #[serde(rename = "schemaVersion", skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i32>,
    #[serde(rename = "formulaId")]
    pub formula_id: String,
    pub latex: String,
    pub omml: String,
    /// "block" | "inline"
    pub display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation: Option<Presentation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render: Option<RenderData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceInfo>,
    #[serde(rename = "storageMode", skip_serializing_if = "Option::is_none")]
    pub storage_mode: Option<String>,
    #[serde(rename = "revision")]
    pub revision: i32,
    #[serde(rename = "createdUtcTicks", default)]
    pub created_utc_ticks: i64,

    // OLE round-trip metadata (v4 fields, backward-compatible)
    /// Host application: "word", "excel", "powerpoint"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// Document context identifier at insertion time
    #[serde(rename = "documentContext", skip_serializing_if = "Option::is_none")]
    pub document_context: Option<String>,
    /// Host-specific object context (e.g., Worksheet+Cell for Excel)
    #[serde(rename = "objectContext", skip_serializing_if = "Option::is_none")]
    pub object_context: Option<String>,
    /// Protocol version at creation time
    #[serde(rename = "protocolVersion", skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub alignment: String,
    #[serde(rename = "fontScale")]
    pub font_scale: f32,
    pub color: String,
    #[serde(rename = "emfBase64", skip_serializing_if = "Option::is_none")]
    pub emf_base64: Option<String>,
    #[serde(rename = "emfKind", skip_serializing_if = "Option::is_none")]
    pub emf_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderData {
    pub svg: Option<String>,
    pub png: Option<String>,
    #[serde(rename = "widthPt")]
    pub width_pt: f32,
    #[serde(rename = "heightPt")]
    pub height_pt: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    #[serde(rename = "coreVersion")]
    pub core_version: String,
    #[serde(rename = "converterVersion")]
    pub converter_version: String,
    #[serde(rename = "ommlSha256")]
    pub omml_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TablePayload {
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub table: TableBlock,
    /// Formula payloads referenced by formulaRef in cells.
    /// Key is formulaId, value is the full FormulaPayload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formulas: Option<std::collections::HashMap<String, FormulaPayload>>,
}

/// Mirrors Core TableBlock structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBlock {
    pub rows: Vec<TableRow>,
    pub properties: Option<TableProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableCell {
    pub rowspan: u32,
    pub colspan: u32,
    pub inlines: Vec<InlineContent>,
    pub properties: Option<CellProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(
    clippy::large_enum_variant,
    reason = "Inlining the formula payload keeps the versioned JSON schema stable"
)]
pub enum InlineContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "formula")]
    Formula {
        #[serde(rename = "formulaRef")]
        formula_ref: String,
        /// Optional inline formula payload for direct insertion.
        #[serde(skip_serializing_if = "Option::is_none")]
        formula: Option<FormulaPayload>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableProperties {
    pub layout: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellProperties {
    pub alignment: Option<String>,
    #[serde(rename = "verticalAlignment")]
    pub vertical_alignment: Option<String>,
    pub background: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InsertMode {
    #[serde(rename = "inline")]
    Inline,
    #[serde(rename = "display")]
    Display,
    #[serde(rename = "displayNumbered")]
    DisplayNumbered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatOptions {
    #[serde(rename = "fontFamily", skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(rename = "fontSize", skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    #[serde(rename = "fontColor", skip_serializing_if = "Option::is_none")]
    pub font_color: Option<String>,
}

// ---------------------------------------------------------------------------
// Frame encoding / decoding
// ---------------------------------------------------------------------------

/// A decoded protocol message envelope (either direction).
#[derive(Debug, Clone)]
#[allow(
    dead_code,
    reason = "Shared envelope consumed by protocol conformance tests"
)]
pub enum Message {
    Vsto(VstoMessage),
    Desktop(DesktopMessage),
}

/// Encode a message into length-prefixed UTF-8 JSON bytes.
pub fn encode_frame<T: Serialize>(msg: &T) -> Vec<u8> {
    let payload = serde_json::to_vec(msg).expect("failed to serialize protocol message");
    let len = (payload.len() as u32).to_le_bytes();
    let mut buf = Vec::with_capacity(4 + payload.len());
    buf.extend_from_slice(&len);
    buf.extend_from_slice(&payload);
    buf
}

/// Try to decode a length-prefixed JSON frame from raw bytes.
/// Returns `Ok((message, bytes_consumed))` or `Err` on parse failure.
pub fn decode_vsto_frame(bytes: &[u8]) -> Result<(VstoMessage, usize), ProtocolError> {
    if bytes.len() < 4 {
        return Err(ProtocolError::InsufficientData);
    }
    let len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if bytes.len() < 4 + len {
        return Err(ProtocolError::InsufficientData);
    }
    let payload = &bytes[4..4 + len];
    let msg: VstoMessage =
        serde_json::from_slice(payload).map_err(|e| ProtocolError::JsonParse(e.to_string()))?;
    Ok((msg, 4 + len))
}

#[allow(
    dead_code,
    reason = "Desktop-frame decoder is used by protocol conformance tests"
)]
pub fn decode_desktop_frame(bytes: &[u8]) -> Result<(DesktopMessage, usize), ProtocolError> {
    if bytes.len() < 4 {
        return Err(ProtocolError::InsufficientData);
    }
    let len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if bytes.len() < 4 + len {
        return Err(ProtocolError::InsufficientData);
    }
    let payload = &bytes[4..4 + len];
    let msg: DesktopMessage =
        serde_json::from_slice(payload).map_err(|e| ProtocolError::JsonParse(e.to_string()))?;
    Ok((msg, 4 + len))
}

// ---------------------------------------------------------------------------
// Integration mode
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaIntegrationMode {
    Auto,
    Native,
    Image,
    Vector,
    Ole,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum ProtocolError {
    InsufficientData,
    JsonParse(String),
    Io(std::io::Error),
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InsufficientData => write!(f, "insufficient data for frame header"),
            Self::JsonParse(e) => write!(f, "JSON parse error: {}", e),
            Self::Io(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl std::error::Error for ProtocolError {}

impl From<std::io::Error> for ProtocolError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Default scope for scan operations.
fn default_scan_scope() -> String {
    "entireDocument".to_string()
}

// ---------------------------------------------------------------------------
// Batch protocol wire types (shared between Desktop and VSTO)
// ---------------------------------------------------------------------------

/// Wire-format LaTeX candidate, received from VSTO scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexCandidateWire {
    pub id: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_latex: Option<String>,
    pub location: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_hash: Option<String>,
    pub confidence: f64,
}

/// Wire-format batch failure, reported by VSTO after execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFailureWire {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    #[serde(rename = "sourceText")]
    pub source_text: String,
    pub error: String,
}
