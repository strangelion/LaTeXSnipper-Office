use tauri::command;

/// Convert OMML XML string to LaTeX via core.
pub fn omml_to_latex_str(xml: &str) -> Result<String, String> {
    latexsnipper_conversion::DocumentConverter::convert_omml_string(
        xml,
        latexsnipper_conversion::OutputFormat::Latex,
    )
    .map_err(|e| e.to_string())
}

/// Convert LaTeX string to OMML XML via core.
pub fn latex_to_omml_str(latex: &str) -> Result<String, String> {
    latexsnipper_conversion::DocumentConverter::convert_latex_string(
        latex,
        latexsnipper_conversion::OutputFormat::OMML,
    )
    .map_err(|e| e.to_string())
}

/// Convert LaTeX string to any format via core.
pub fn latex_to_format(
    latex: &str,
    format: latexsnipper_conversion::OutputFormat,
) -> Result<String, String> {
    latexsnipper_conversion::DocumentConverter::convert_latex_string(latex, format)
        .map_err(|e| e.to_string())
}

/// Convert MathML string to LaTeX via core.
pub fn mathml_to_latex_str(mathml: &str) -> Result<String, String> {
    latexsnipper_conversion::DocumentConverter::convert_mathml_string(
        mathml,
        latexsnipper_conversion::OutputFormat::Latex,
    )
    .map_err(|e| e.to_string())
}

#[command]
pub fn omml_to_latex(xml: String) -> Result<String, String> {
    println!("[Math] omml_to_latex called, input length: {}", xml.len());
    let result = omml_to_latex_str(&xml);
    match &result {
        Ok(latex) => println!("[Math] omml_to_latex result: '{}'", latex),
        Err(e) => println!("[Math] omml_to_latex error: {}", e),
    }
    result
}

#[command]
pub fn latex_to_omml(latex: String) -> Result<String, String> {
    latex_to_omml_str(&latex)
}

#[command]
pub fn mathml_to_latex(mathml: String) -> Result<String, String> {
    mathml_to_latex_str(&mathml)
}

#[command]
pub fn convert_formula(latex: String, target_format: String) -> Result<String, String> {
    let fmt = match target_format.as_str() {
        "latex" => latexsnipper_conversion::OutputFormat::Latex,
        "mathml" => latexsnipper_conversion::OutputFormat::MathML,
        "omml" => latexsnipper_conversion::OutputFormat::OMML,
        "typst" => latexsnipper_conversion::OutputFormat::Typst,
        "markdown" => latexsnipper_conversion::OutputFormat::MarkdownBlock,
        "html" => latexsnipper_conversion::OutputFormat::Html,
        _ => return Err(format!("Unsupported format: {}", target_format)),
    };
    latex_to_format(&latex, fmt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_omml_to_latex_via_core() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert!(result.contains("\\frac{a}{b}"), "got: {}", result);
    }

    #[test]
    fn test_latex_to_omml_via_core() {
        let result = latex_to_omml_str(r"\frac{a}{b}").unwrap();
        assert!(result.contains("<m:f>"), "got: {}", result);
        assert!(result.contains("<m:num>"), "got: {}", result);
    }

    #[test]
    fn test_convert_formula() {
        let result = convert_formula(r"\alpha + \beta".to_string(), "mathml".to_string()).unwrap();
        assert!(result.contains("<math"), "got: {}", result);
    }

    #[test]
    fn test_mathml_to_latex() {
        let xml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"#;
        let result = mathml_to_latex_str(xml).unwrap();
        assert!(result.contains("frac"), "got: {}", result);
    }
}
