use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaMetadata {
    pub schema_version: u32,
    pub identity: FormulaIdentity,
    pub latex: String,
    pub display_mode: DisplayMode,
    pub numbering_mode: NumberingMode,
    pub number_text: String,
    pub render_engine: RenderEngine,
    pub font: FontSettings,
    pub size: SizeSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaIdentity {
    pub document_id: String,
    pub equation_id: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DisplayMode {
    Inline,
    Display,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NumberingMode {
    None,
    Auto,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RenderEngine {
    MathJaxSVG,
    MathJaxPNG,
    NativeOMML,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SizeSettings {
    pub natural_width: f64,
    pub natural_height: f64,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontSettings {
    pub color: String,
    pub style: FontStyle,
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FontStyle {
    TeX,
    Roman,
    Bold,
    Italic,
    BoldItalic,
}

impl FormulaMetadata {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.identity.document_id.is_empty() {
            errors.push("document_id is required".to_string());
        }
        if self.identity.equation_id.is_empty() {
            errors.push("equation_id is required".to_string());
        }
        if self.latex.is_empty() {
            errors.push("latex is required".to_string());
        }
        if self.font.scale <= 0.0 || self.font.scale > 10.0 {
            errors.push("font scale must be between 0 and 10".to_string());
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}
