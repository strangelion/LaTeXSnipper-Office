//! Input validation helpers for recognition commands.

use std::path::Path;

/// Supported input extensions.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp", // Raster images
    "pdf",  // PDF documents
];

/// Supported output formats.
const SUPPORTED_OUTPUT_FORMATS: &[&str] = &["markdown", "latex", "typst", "html", "omml", "json"];

/// Supported recognition modes.
const SUPPORTED_MODES: &[&str] = &["auto", "formula", "text", "table", "full-document"];

/// Validate that a file path exists and has a supported extension.
pub fn validate_input_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    if !p.is_file() {
        return Err(format!("Input file does not exist: {}", p.display()));
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match ext {
        Some(ref e) if SUPPORTED_EXTENSIONS.contains(&e.as_str()) => Ok(()),
        Some(e) => Err(format!(
            "Unsupported file type '.{e}'. Supported: {SUPPORTED_EXTENSIONS:?}"
        )),
        None => Err("File has no extension; cannot determine type".to_string()),
    }
}

/// Validate recognition mode string.
pub fn validate_mode(mode: &str) -> Result<(), String> {
    if SUPPORTED_MODES.contains(&mode) {
        Ok(())
    } else {
        Err(format!(
            "Unknown recognition mode '{mode}'. Supported: {SUPPORTED_MODES:?}"
        ))
    }
}

/// Validate output format string.
pub fn validate_output_format(format: &str) -> Result<(), String> {
    if SUPPORTED_OUTPUT_FORMATS.contains(&format) {
        Ok(())
    } else {
        Err(format!(
            "Unknown output format '{format}'. Supported: {SUPPORTED_OUTPUT_FORMATS:?}"
        ))
    }
}
