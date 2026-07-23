//! OCR commands.
//!
//! The `ocr_recognize` command is preserved as a backward-compatibility shim
//! that routes legacy base64 requests through the new RecognitionService.
//! New code should use `recognition_start` instead.
//!
//! # Migration
//!
//! ```text
//! old: invoke("ocr_recognize", { imageData: "<base64>" })
//! new: invoke("recognition_start", { path: "..." })
//! ```

use serde::Serialize;
use tauri::command;

#[cfg(feature = "recognition")]
use latexsnipper_engine::sdk::Snipper;

#[derive(Debug, Serialize)]
pub struct OcrResult {
    pub latex: String,
    pub confidence: f64,
    pub markdown: String,
}

#[command]
pub async fn screenshot_capture() -> Result<String, String> {
    // TODO: Implement actual screenshot capture
    Err("Screenshot capture not yet implemented".to_string())
}

/// Legacy OCR command — kept for backward compatibility.
///
/// Internal flow:
///   Base64 → jobs/<uuid>/source.png → RecognitionService → old OcrResult DTO
///
/// New callers should use `recognition_start` instead.
#[command]
#[deprecated(note = "Use recognition_start instead")]
pub async fn ocr_recognize(image_data: String) -> Result<OcrResult, String> {
    #[cfg(not(feature = "recognition"))]
    {
        let _ = image_data;
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
            return Err("OCR is only supported on Windows (requires ONNX Runtime)".to_string());
        }

        #[cfg(target_os = "windows")]
        {
            log::info!("Starting OCR recognition (legacy path)");

            // Decode base64 image data
            use base64::Engine;
            let image_bytes = base64::engine::general_purpose::STANDARD
                .decode(&image_data)
                .map_err(|e| format!("Failed to decode base64: {}", e))?;

            // Save to a unique job-scoped path (no more hard-coded latexsnipper_temp.png)
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

            // Process with Engine SDK (no more direct pipeline::sdk::Snipper)
            let snipper = Snipper::from_file(&source_path)
                .map_err(|e| format!("Failed to process image: {}", e))?;

            // Get results
            let latex = snipper
                .to_latex()
                .map_err(|e| format!("Failed to convert to LaTeX: {}", e))?;

            let markdown = snipper
                .to_markdown()
                .map_err(|e| format!("Failed to convert to Markdown: {}", e))?;

            // Calculate average confidence
            let blocks = snipper.document().all_blocks();
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

/// Generate a simple UUID-like string from timestamp.
fn simple_uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}
