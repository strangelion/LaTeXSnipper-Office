use crate::engine::{
    font::{FontHandler, FontStyle},
    renderer::{FormulaRenderer, RenderFormat, RenderOptions},
};
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Deserialize)]
pub struct RenderFormulaRequest {
    pub latex: String,
    pub display: bool,
    pub formats: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RenderFormulaResponse {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[command]
pub async fn render_formula(request: RenderFormulaRequest) -> Result<RenderFormulaResponse, String> {
    let renderer = FormulaRenderer::new();

    let formats: Vec<RenderFormat> = request
        .formats
        .iter()
        .filter_map(|f| match f.as_str() {
            "mathml" => Some(RenderFormat::MathML),
            "svg" => Some(RenderFormat::SVG),
            "png" => Some(RenderFormat::PNG),
            "omml" => Some(RenderFormat::OMML),
            _ => None,
        })
        .collect();

    let options = RenderOptions {
        display: request.display,
        formats,
        dpi: 192,
        font_scale: 1.0,
        theme: "light".to_string(),
    };

    match renderer.render(&request.latex, &options).await {
        Ok(result) => Ok(RenderFormulaResponse {
            success: true,
            result: Some(serde_json::to_value(result).unwrap()),
            error: None,
        }),
        Err(e) => Ok(RenderFormulaResponse {
            success: false,
            result: None,
            error: Some(e),
        }),
    }
}

#[command]
pub async fn apply_font_style(latex: String, style: String) -> Result<String, String> {
    let font_style = match style.as_str() {
        "tex" => FontStyle::TeX,
        "roman" => FontStyle::Roman,
        "bold" => FontStyle::Bold,
        "italic" => FontStyle::Italic,
        "bold_italic" => FontStyle::BoldItalic,
        _ => return Err("Invalid font style".to_string()),
    };

    Ok(FontHandler::apply_font_style(&latex, &font_style))
}

#[command]
pub async fn apply_color(latex: String, color: String) -> Result<String, String> {
    Ok(FontHandler::apply_color(&latex, &color))
}
