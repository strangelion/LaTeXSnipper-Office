use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FontStyle {
    TeX,
    Roman,
    Bold,
    Italic,
    BoldItalic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct FontSettings {
    pub color: String,
    pub style: FontStyle,
    pub scale: f64,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            color: "#000000".to_string(),
            style: FontStyle::TeX,
            scale: 1.0,
        }
    }
}

pub struct FontHandler;

impl FontHandler {
    pub fn apply_font_style(latex: &str, style: &FontStyle) -> String {
        match style {
            FontStyle::TeX => latex.to_string(),
            FontStyle::Roman => format!("\\mathrm{{{}}}", latex),
            FontStyle::Bold => format!("\\mathbf{{{}}}", latex),
            FontStyle::Italic => format!("\\mathit{{{}}}", latex),
            FontStyle::BoldItalic => format!("\\bm{{{}}}", latex),
        }
    }

    pub fn apply_color(latex: &str, color: &str) -> String {
        if color == "#000000" || color.is_empty() {
            return latex.to_string();
        }
        format!("\\color{{{}}}{{{}}}", color, latex)
    }

    #[allow(dead_code)]
    pub fn calculate_scale(base: f64, user: f64, context: f64) -> f64 {
        let scale = base * user * context;
        scale.max(0.1).min(10.0)
    }
}
