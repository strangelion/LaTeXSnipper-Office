//! OCR commands.
//!
//! The `ocr_recognize` command is preserved as a backward-compatibility shim
//! that routes legacy base64 requests through the managed RecognitionService.
//! New code should use `recognition_start` instead.
//!
//! # Migration
//!
//! ```text
//! old: invoke("ocr_recognize", { imageData: "<base64>" })
//! new: invoke("recognition_start", { path: "..." })
//! ```

use serde::Serialize;
use tauri::{command, State};

#[cfg(feature = "recognition")]
use crate::recognition::dto::RecognitionStartRequest;
use crate::recognition::state::RecognitionState;

#[derive(Debug, Serialize)]
pub struct OcrResult {
    pub latex: String,
    pub confidence: f64,
    pub markdown: String,
}

#[command]
pub async fn screenshot_capture() -> Result<String, String> {
    Err("Screenshot capture not yet implemented".to_string())
}

/// Legacy OCR command — kept for backward compatibility.
///
/// Internal flow:
///   Base64 → job temp → RecognitionState.service() → Formula Recognition → OcrResult DTO
///
/// This goes through the SAME RecognitionService as `recognition_start`,
/// NOT through a separate raw Snipper::from_file() path.
#[command]
#[deprecated(note = "Use recognition_start instead")]
pub async fn ocr_recognize(
    state: State<'_, RecognitionState>,
    image_data: String,
) -> Result<OcrResult, String> {
    #[cfg(not(feature = "recognition"))]
    {
        let _ = (state, image_data);
        Err(
            "OCR recognition is not included in the default Office Bridge build. \
             Rebuild with the recognition feature to enable local OCR."
                .to_string(),
        )
    }

    #[cfg(feature = "recognition")]
    {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (state, image_data);
            Err("OCR is only supported on Windows (requires ONNX Runtime)".to_string())
        }

        #[cfg(target_os = "windows")]
        {
            log::info!("Starting OCR recognition (legacy path, routed through RecognitionService)");

            // Decode base64 image data
            use base64::Engine;
            let image_bytes = base64::engine::general_purpose::STANDARD
                .decode(&image_data)
                .map_err(|e| format!("Failed to decode base64: {}", e))?;

            // Save to a unique job-scoped path
            let job_id = simple_uuid();
            let temp_dir = std::env::temp_dir()
                .join("latexsnipper")
                .join("jobs")
                .join(&job_id);
            std::fs::create_dir_all(&temp_dir)
                .map_err(|e| format!("Failed to create job temp dir: {}", e))?;
            let source_path = temp_dir.join("source.png");
            std::fs::write(&source_path, &image_bytes)
                .map_err(|e| format!("Failed to write temp file: {}", e))?;

            // Build a formula-only recognition request
            let request = RecognitionStartRequest {
                path: source_path.to_string_lossy().to_string(),
                mode: "formula".to_string(),
                parse_mode: None,
                execution_policy: None,
                model_overrides: None,
            };

            // Route through managed RecognitionService (NOT raw Snipper::from_file)
            let service = state.service().await?;
            let document = service.recognize(&source_path, &request).await?;

            // Convert Document AST to OcrResult using the conversion crate
            use latexsnipper_conversion::{DocumentConverter, OutputFormat};
            let latex = DocumentConverter::new(OutputFormat::Latex)
                .convert(&document)
                .map_err(|e| format!("LaTeX conversion failed: {e}"))?;

            let markdown = DocumentConverter::new(OutputFormat::MarkdownBlock)
                .convert(&document)
                .map_err(|e| format!("Markdown conversion failed: {e}"))?;

            // Calculate average confidence across formula blocks
            let blocks = document.all_blocks();
            let confidence = if blocks.is_empty() {
                0.0
            } else {
                let total: f32 = blocks
                    .iter()
                    .filter_map(|b| {
                        if let latexsnipper_ast::Block::Formula(f) = b {
                            Some(f.formula.confidence)
                        } else {
                            None
                        }
                    })
                    .sum();
                let count = blocks
                    .iter()
                    .filter(|b| matches!(b, latexsnipper_ast::Block::Formula(_)))
                    .count();
                if count > 0 {
                    total / count as f32
                } else {
                    0.0
                }
            };

            // Clean up temp file
            let _ = std::fs::remove_dir_all(&temp_dir);

            log::info!(
                "OCR recognition complete: {} blocks, confidence: {:.2}",
                blocks.len(),
                confidence
            );

            Ok(OcrResult {
                latex,
                confidence: confidence as f64,
                markdown,
            })
        }
    }
}

#[allow(dead_code)]
fn simple_uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
