pub mod ast;
pub mod omml;
pub mod latex;

use tauri::command;

/// Convert OMML XML string to LaTeX.
pub fn omml_to_latex_str(xml: &str) -> Result<String, String> {
    let node = omml::parse_omml(xml)?;
    Ok(latex::node_to_latex(&node))
}

/// Convert LaTeX string to OMML XML (stub for now).
pub fn latex_to_omml_str(latex: &str) -> Result<String, String> {
    Err(format!("latex_to_omml not yet implemented for: {}", latex))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fraction() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert_eq!(result, "\\frac{a}{b}");
    }

    #[test]
    fn test_superscript() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert_eq!(result, "{x}^{2}");
    }

    #[test]
    fn test_subscript() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert_eq!(result, "{x}_{i}");
    }

    #[test]
    fn test_sqrt() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert_eq!(result, "\\sqrt{x}");
    }

    #[test]
    fn test_emc2() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>E</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>m</m:t></m:r><m:r><m:t>c</m:t></m:r><m:sSup><m:e><m:r><m:t></m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert!(result.contains("E"), "should contain E: {}", result);
        assert!(result.contains("="), "should contain =: {}", result);
        assert!(result.contains("m"), "should contain m: {}", result);
        assert!(result.contains("c"), "should contain c: {}", result);
    }

    #[test]
    fn test_emc2_from_word_doc() {
        let xml = r#"<?xml version="1.0" standalone="yes"?>
<?mso-application progid="Word.Document"?>
<w:wordDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<m:oMathPara><m:oMath><m:r><m:t>E</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>m</m:t></m:r><m:r><m:t>c</m:t></m:r><m:sSup><m:e><m:r><m:t></m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara>
</w:wordDocument>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert!(result.contains("E"), "should contain E: {}", result);
        assert!(result.contains("="), "should contain =: {}", result);
        assert!(result.contains("m"), "should contain m: {}", result);
        assert!(result.contains("c"), "should contain c: {}", result);
    }

    #[test]
    fn test_sum() {
        let xml = r#"<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>"#;
        let result = omml_to_latex_str(xml).unwrap();
        assert!(result.contains("\\sum"), "should contain \\sum: {}", result);
    }
}
