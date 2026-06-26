use crate::core::metadata::FormulaMetadata;
use serde::{Deserialize, Serialize};
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
        identity: crate::core::metadata::FormulaIdentity {
            document_id,
            equation_id,
            revision: String::new(),
        },
        latex,
        display_mode: crate::core::metadata::DisplayMode::Inline,
        numbering_mode: crate::core::metadata::NumberingMode::None,
        number_text: String::new(),
        render_engine: crate::core::metadata::RenderEngine::MathJaxSVG,
        font: crate::core::metadata::FontSettings {
            color: "#000000".to_string(),
            style: crate::core::metadata::FontStyle::TeX,
            scale: 1.0,
        },
        size: crate::core::metadata::SizeSettings {
            natural_width: 0.0,
            natural_height: 0.0,
            scale_factor: 1.0,
        },
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}
