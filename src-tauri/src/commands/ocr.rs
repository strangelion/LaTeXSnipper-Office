use latexsnipper_ast::Block;
use latexsnipper_pipeline::sdk::Snipper;
use serde::Serialize;
use tauri::command;

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

#[command]
pub async fn ocr_recognize(image_data: String) -> Result<OcrResult, String> {
    log::info!("Starting OCR recognition");

    // Decode base64 image data
    use base64::Engine;
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Save to temp file for SDK processing
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join("latexsnipper_temp.png");
    std::fs::write(&temp_path, &image_bytes)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Process with SDK
    let snipper =
        Snipper::from_file(&temp_path).map_err(|e| format!("Failed to process image: {}", e))?;

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
                if let Block::Formula(f) = b {
                    Some(f.formula.confidence)
                } else {
                    None
                }
            })
            .sum();
        let count = blocks
            .iter()
            .filter(|b| matches!(b, Block::Formula(_)))
            .count();
        if count > 0 {
            total / count as f32
        } else {
            0.0
        }
    };

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);

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
