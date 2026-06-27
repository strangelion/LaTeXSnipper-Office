use crate::engine::metadata::FormulaMetadata;
use serde::Serialize;
use tauri::command;

#[derive(Debug, Serialize)]
pub struct ValidateMetadataResponse {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[command]
pub async fn validate_metadata(metadata: FormulaMetadata) -> Result<ValidateMetadataResponse, String> {
    match metadata.validate() {
        Ok(()) => Ok(ValidateMetadataResponse {
            valid: true,
            errors: vec![],
        }),
        Err(errors) => Ok(ValidateMetadataResponse {
            valid: false,
            errors,
        }),
    }
}

#[command]
pub async fn create_metadata(
    document_id: String,
    equation_id: String,
    latex: String,
) -> Result<FormulaMetadata, String> {
    use chrono::Utc;

    Ok(FormulaMetadata {
        schema_version: 2,
        identity: crate::engine::metadata::FormulaIdentity {
            document_id,
            equation_id,
            revision: String::new(),
        },
        latex,
        display_mode: crate::engine::metadata::DisplayMode::Inline,
        numbering_mode: crate::engine::metadata::NumberingMode::None,
        number_text: String::new(),
        render_engine: crate::engine::metadata::RenderEngine::MathJaxSVG,
        font: crate::engine::metadata::FontSettings {
            color: "#000000".to_string(),
            style: crate::engine::metadata::FontStyle::TeX,
            scale: 1.0,
        },
        size: crate::engine::metadata::SizeSettings {
            natural_width: 0.0,
            natural_height: 0.0,
            scale_factor: 1.0,
        },
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}
