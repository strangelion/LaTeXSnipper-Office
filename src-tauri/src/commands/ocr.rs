use serde::Serialize;
use tauri::command;

#[derive(Debug, Serialize)]
pub struct OcrResult {
    pub latex: String,
    pub confidence: f64,
}

#[command]
pub async fn screenshot_capture() -> Result<String, String> {
    // TODO: Implement actual screenshot capture
    Err("Screenshot capture not yet implemented".to_string())
}

#[command]
pub async fn ocr_recognize(_image_data: String) -> Result<OcrResult, String> {
    // TODO: Implement OCR recognition
    Err("OCR recognition not yet implemented".to_string())
}
