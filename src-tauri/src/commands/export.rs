use latexsnipper_conversion::{DocumentConverter, OutputFormat};
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
    let fmt = match request.format.as_str() {
        "latex" => OutputFormat::Latex,
        "mathml" => OutputFormat::MathML,
        "omml" => OutputFormat::OMML,
        "typst" => OutputFormat::Typst,
        "markdown" => OutputFormat::MarkdownBlock,
        "html" => OutputFormat::Html,
        _ => {
            return Ok(ExportFormulaResponse {
                success: false,
                content: None,
                mime_type: None,
                error: Some(format!("Unsupported format: {}", request.format)),
            });
        }
    };

    let content = DocumentConverter::convert_latex_string(&request.latex, fmt)
        .map_err(|e| e.to_string());

    match content {
        Ok(c) => {
            let mime_type = match request.format.as_str() {
                "latex" => "text/plain",
                "mathml" => "application/mathml+xml",
                "omml" => "application/xml",
                "typst" => "text/plain",
                "markdown" => "text/markdown",
                "html" => "text/html",
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
