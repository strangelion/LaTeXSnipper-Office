//! Data Transfer Objects for recognition commands.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

/// Request to start a new recognition job.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionStartRequest {
    /// Path to the input file (image, PDF, etc.)
    pub path: String,

    /// Recognition mode: "auto", "formula", "text", "table", "full-document"
    pub mode: String,

    /// Document parse mode override.
    pub parse_mode: Option<String>,

    /// Execution policy: "sync", "async"
    pub execution_policy: Option<String>,

    /// Per-task model overrides.
    pub model_overrides: Option<ModelOverridesDto>,
}

/// Per-task model variant overrides.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOverridesDto {
    pub formula_det: Option<String>,
    pub formula_rec: Option<String>,
    pub text_det: Option<String>,
    pub text_rec: Option<String>,
    pub table_det: Option<String>,
    pub table_struct: Option<String>,
}

/// Response returned immediately after starting a recognition job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionStartResponse {
    /// Unique job identifier.
    pub job_id: String,
}

/// Request to retrieve the output of a completed job.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOutputRequest {
    /// The job identifier.
    pub job_id: String,

    /// Desired output format: "markdown", "latex", "typst", "html", "omml", "json"
    pub format: String,
}

/// Response containing the output of a job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOutputResponse {
    /// Whether the output was generated successfully.
    pub success: bool,

    /// The output content (if success).
    pub content: Option<String>,

    /// Error message (if !success).
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/// Describes what the current recognition backend supports.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionCapabilities {
    /// Whether recognition is available (feature gate).
    pub available: bool,

    /// Available recognition modes.
    pub modes: Vec<String>,

    /// Available output formats.
    pub output_formats: Vec<String>,

    /// Maximum supported image resolution.
    pub max_resolution: Option<u32>,

    /// Number of currently active jobs.
    pub active_jobs: usize,
}
