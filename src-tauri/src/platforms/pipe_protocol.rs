//! Named Pipe protocol definitions for LaTeXSnipper Native Office v2.
//!
//! All messages use length-prefixed UTF-8 JSON framing:
//!   [4 bytes LE payload length] [UTF-8 JSON payload]

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const PIPE_PREFIX: &str = "LaTeXSnipper.NativeOffice.v2";
pub const CUSTOM_XML_NAMESPACE: &str = "urn:latexsnipper:native-office:v2";

// ---------------------------------------------------------------------------
// VSTO -> Desktop messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
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
        #[serde(rename = "documentId", skip_serializing_if = "Option::is_none")]
        documentId: Option<String>,
    },

    #[serde(rename = "OPEN_EDITOR")]
    OpenEditor {
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

    #[serde(rename = "READ_TABLE")]
    ReadTable {
        requestId: String,
        sessionId: String,
        #[serde(rename = "table", skip_serializing_if = "Option::is_none")]
        table: Option<TablePayload>,
        #[serde(rename = "tableXml", skip_serializing_if = "Option::is_none")]
        tableXml: Option<String>,
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
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    #[serde(rename = "REPLACE_RESULT")]
    ReplaceResult {
        requestId: String,
        sessionId: String,
        success: bool,
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
}

// ---------------------------------------------------------------------------
// Desktop -> VSTO messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
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
        formula: FormulaPayload,
        mode: InsertMode,
    },

    #[serde(rename = "REPLACE_FORMULA")]
    ReplaceFormula {
        requestId: String,
        sessionId: String,
        #[serde(rename = "formulaId")]
        formulaId: String,
        formula: FormulaPayload,
    },

    #[serde(rename = "INSERT_TABLE")]
    InsertTable {
        requestId: String,
        sessionId: String,
        table: TablePayload,
    },

    #[serde(rename = "REQUEST_READ_SELECTION")]
    RequestReadSelection {
        requestId: String,
        sessionId: String,
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
        #[serde(rename = "formulaId", skip_serializing_if = "Option::is_none")]
        formulaId: Option<String>,
    },

    #[serde(rename = "FORMAT_SELECTION")]
    FormatSelection {
        requestId: String,
        sessionId: String,
        options: FormatOptions,
    },

    #[serde(rename = "FORMAT_ALL")]
    FormatAll {
        requestId: String,
        sessionId: String,
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
        #[serde(rename = "formulaId")]
        formulaId: String,
        #[serde(rename = "referenceType")]
        referenceType: String,
    },
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaPayload {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub alignment: String,
    #[serde(rename = "fontScale")]
    pub font_scale: f32,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderData {
    pub svg: Option<String>,
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
