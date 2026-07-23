//! Office integration DTOs — shared data types for the insertion pipeline.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Office host types
// ---------------------------------------------------------------------------

/// Supported Office hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OfficeHost {
    Word,
    Excel,
    PowerPoint,
    Visio,
}

impl OfficeHost {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "word" => Some(Self::Word),
            "excel" => Some(Self::Excel),
            "powerpoint" => Some(Self::PowerPoint),
            "visio" => Some(Self::Visio),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Office target
// ---------------------------------------------------------------------------

/// Fully qualified target for an Office operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeTarget {
    /// Which Office application.
    pub host: OfficeHost,

    /// The session ID (from the Named Pipe session manager).
    pub session_id: String,

    /// Document context identifier.
    pub document_context: String,
}

// ---------------------------------------------------------------------------
// Artifact types
// ---------------------------------------------------------------------------

/// Types of content that can be inserted into Office.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactType {
    Formula,
    Table,
    Document,
}

/// An artifact ready for Office insertion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    /// What kind of artifact.
    pub artifact_type: ArtifactType,

    /// The content in the requested format.
    pub payload: serde_json::Value,

    /// Target Office application.
    pub target: OfficeTarget,

    /// Optional options per insertion type.
    pub options: ArtifactOptions,
}

/// Options for artifact insertion.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactOptions {
    /// Display mode for formulas: "inline", "display", "numbered"
    pub display: Option<String>,

    /// Storage mode: "native", "ole", "image", "auto"
    pub storage_mode: Option<String>,

    /// Worksheet identifier (Excel only).
    pub worksheet_id: Option<String>,

    /// Anchor cell address (Excel only).
    pub anchor_cell: Option<String>,
}

// ---------------------------------------------------------------------------
// Formula insertion
// ---------------------------------------------------------------------------

/// Unified formula insertion request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertFormulaRequest {
    /// Format of the content: "latex", "omml", "mathml"
    pub format: String,

    /// The formula content.
    pub content: String,

    /// Target Office host.
    pub target_host: String,

    /// Optional session ID override.
    pub session_id: Option<String>,

    /// Optional document context.
    pub document_context: Option<String>,

    /// Display mode.
    pub display: Option<String>,

    /// Storage mode.
    pub storage_mode: Option<String>,
}

/// Response from a formula insertion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertFormulaResponse {
    pub success: bool,
    pub formula_id: Option<String>,
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

/// Request to start a batch LaTeX→OMML conversion.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConvertLatexRequest {
    /// Target Office host.
    pub host: OfficeHost,

    /// Conversion scope.
    pub scope: BatchConversionScope,

    /// LaTeX detection mode.
    pub detection_mode: String,

    /// Whether to replace the LaTeX source text.
    pub replace_source: bool,

    /// Whether to continue on error for individual items.
    pub continue_on_error: bool,
}

/// Scope of a batch conversion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchConversionScope {
    /// Current selection.
    Selection,

    /// Current slide (PowerPoint).
    CurrentSlide,

    /// Selected slides (PowerPoint).
    SelectedSlides,

    /// Entire presentation/document.
    EntireDocument,
}

/// A single item in a batch conversion plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConversionItem {
    /// Unique identifier for the source location.
    pub source_id: String,

    /// Original LaTeX text.
    pub source_text: String,

    /// Normalized LaTeX.
    pub normalized_latex: String,

    /// Converted OMML (set after conversion).
    pub omml: Option<String>,

    /// Item status.
    pub status: BatchItemStatus,

    /// Error message (if failed).
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchItemStatus {
    Pending,
    Converting,
    Converted,
    Failed,
    Skipped,
}

/// A batch conversion plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConversionPlan {
    /// Unique plan identifier.
    pub id: String,

    /// Items to convert.
    pub items: Vec<BatchConversionItem>,
}

/// Result of a completed batch conversion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConversionResult {
    /// Total number of items.
    pub total: usize,

    /// Successfully converted.
    pub converted: usize,

    /// Skipped.
    pub skipped: usize,

    /// Failed.
    pub failed: usize,

    /// Details of failures.
    pub failures: Vec<BatchFailure>,
}

/// Details of a failed batch item.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFailure {
    pub source_id: String,
    pub source_text: String,
    pub error: String,
}

// ---------------------------------------------------------------------------
// Latex candidate (from Office scan)
// ---------------------------------------------------------------------------

/// A LaTeX candidate detected in an Office document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexCandidate {
    /// Unique identifier.
    pub id: String,

    /// Raw source text.
    pub source: String,

    /// Normalized LaTeX.
    pub normalized_latex: Option<String>,

    /// Location description (e.g., "Body/Paragraph 5", "Table 2 / Cell A1").
    pub location: String,

    /// Detection confidence (0.0 – 1.0).
    pub confidence: f64,
}
