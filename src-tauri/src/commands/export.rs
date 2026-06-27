use crate::engine::renderer::FormulaRenderer;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Deserialize)]
pub struct ExportFormulaRequest {
    pub latex: String,
    pub format: String,
    pub display: bool,
}

#[derive(Debug, Serialize)]
pub struct ExportFormulaResponse {
    pub success: bool,
    pub content: Option<String>,
    pub mime_type: Option<String>,
    pub error: Option<String>,
}

#[command]
pub async fn export_formula(request: ExportFormulaRequest) -> Result<ExportFormulaResponse, String> {
    let renderer = FormulaRenderer::new();

    let content = match request.format.as_str() {
        "latex" => Ok(request.latex.clone()),
        "mathml" => renderer.to_mathml(&request.latex, request.display).await,
        "svg" => renderer.to_svg(&request.latex, request.display).await,
        _ => Err("Unsupported format".to_string()),
    };

    match content {
        Ok(c) => {
            let mime_type = match request.format.as_str() {
                "latex" => "text/plain",
                "mathml" => "application/mathml+xml",
                "svg" => "image/svg+xml",
                _ => "text/plain",
            };
            Ok(ExportFormulaResponse {
                success: true,
                content: Some(c),
                mime_type: Some(mime_type.to_string()),
                error: None,
            })
        }
        Err(e) => Ok(ExportFormulaResponse {
            success: false,
            content: None,
            mime_type: None,
            error: Some(e),
        }),
    }
}

#[command]
pub async fn copy_to_clipboard(_text: String) -> Result<bool, String> {
    // TODO: Implement clipboard copy
    Ok(true)
}
