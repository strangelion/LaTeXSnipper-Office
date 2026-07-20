//! Live preview rendering pipeline for Office formula editing.
//!
//! Converts LaTeX to OMML (via core) and prepares preview data.
//! This runs on the backend side; the frontend handles SVG rendering via MathJax.
//!
//! Pipeline:
//!   LaTeX input
//!     → LaTeX→OMML (core, fast, single formula)
//!     → OMML + metadata returned to frontend
//!     → Frontend renders SVG via MathJax
//!     → Preview displayed in Desktop UI
//!
//! No Office object modification happens during preview.
//! The OMML is only written to Office at commit time.

use serde::{Deserialize, Serialize};

/// Result of a live preview render operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePreviewResult {
    /// Whether the render succeeded.
    pub success: bool,
    /// The generated OMML XML (for commit).
    pub omml: Option<String>,
    /// The original LaTeX input.
    pub latex: String,
    /// Display mode used.
    pub display_mode: String,
    /// Estimated dimensions (from OMML parsing, if available).
    pub width_pt: Option<f32>,
    pub height_pt: Option<f32>,
    /// Error message if render failed.
    pub error: Option<String>,
    /// Warnings/diagnostics from the conversion.
    pub diagnostics: Vec<PreviewDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnostic {
    pub level: String,
    pub message: String,
}

/// Render a live preview: convert LaTeX to OMML via core.
///
/// This is a fast, synchronous operation (single formula, no document overhead).
/// The frontend handles SVG rendering separately via MathJax.
#[tauri::command]
pub async fn render_live_preview(
    latex: String,
    display_mode: Option<String>,
) -> Result<LivePreviewResult, String> {
    let mode = display_mode.unwrap_or_else(|| "block".to_string());

    if latex.trim().is_empty() {
        return Ok(LivePreviewResult {
            success: false,
            omml: None,
            latex,
            display_mode: mode,
            width_pt: None,
            height_pt: None,
            error: Some("Empty LaTeX input".to_string()),
            diagnostics: vec![],
        });
    }

    // Convert LaTeX to OMML via core
    match crate::math::latex_to_omml_str(&latex) {
        Ok(omml) => {
            let (width_pt, height_pt) = estimate_omml_dimensions(&omml);
            Ok(LivePreviewResult {
                success: true,
                omml: Some(omml),
                latex,
                display_mode: mode,
                width_pt: Some(width_pt),
                height_pt: Some(height_pt),
                error: None,
                diagnostics: vec![],
            })
        }
        Err(e) => {
            log::warn!("[LivePreview] LaTeX→OMML failed: {}", e);
            let error_msg = e.clone();
            Ok(LivePreviewResult {
                success: false,
                omml: None,
                latex,
                display_mode: mode,
                width_pt: None,
                height_pt: None,
                error: Some(e),
                diagnostics: vec![PreviewDiagnostic {
                    level: "error".to_string(),
                    message: format!("LaTeX→OMML conversion failed: {}", error_msg),
                }],
            })
        }
    }
}

/// Batch render: convert multiple LaTeX formulas to OMML.
/// Used for re-rendering all formulas in a document.
#[tauri::command]
pub async fn render_live_preview_batch(
    formulas: Vec<RenderBatchItem>,
) -> Result<Vec<LivePreviewResult>, String> {
    let mut results = Vec::with_capacity(formulas.len());
    for item in formulas {
        let result = render_live_preview(item.latex, item.display_mode).await?;
        results.push(result);
    }
    Ok(results)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderBatchItem {
    pub latex: String,
    pub display_mode: Option<String>,
}

/// Estimate OMML dimensions from the XML content.
/// This is a rough heuristic; actual dimensions depend on font metrics.
fn estimate_omml_dimensions(omml: &str) -> (f32, f32) {
    // Simple heuristic: count complexity tokens
    let token_count = omml.matches('<').count();
    let base_width = 60.0_f32;
    let base_height = 24.0_f32;

    // Scale based on content complexity
    let width = base_width + (token_count as f32 * 0.3).min(200.0);
    let height = base_height;

    // Display mode is taller
    let is_display = omml.contains("oMathPara") || token_count > 20;
    let height = if is_display { height * 1.2 } else { height };

    (width, height)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_simple_fraction() {
        let omml = r#"<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>"#;
        let (w, h) = estimate_omml_dimensions(omml);
        assert!(w > 0.0);
        assert!(h > 0.0);
    }

    #[tokio::test]
    async fn empty_latex_returns_error() {
        let result = render_live_preview("".to_string(), None).await.unwrap();
        assert!(!result.success);
        assert!(result.error.is_some());
    }
}
