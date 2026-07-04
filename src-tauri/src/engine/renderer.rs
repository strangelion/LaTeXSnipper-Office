use latexsnipper_conversion::{DocumentConverter, OutputFormat};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderOptions {
    pub display: bool,
    pub formats: Vec<RenderFormat>,
    pub dpi: u32,
    pub font_scale: f64,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RenderFormat {
    MathML,
    SVG,
    PNG,
    OMML,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResult {
    pub latex: String,
    pub display: bool,
    pub mathml: Option<String>,
    pub omml: Option<String>,
    pub svg: Option<String>,
    pub png: Option<String>,
    pub warnings: Vec<String>,
}

pub struct FormulaRenderer;

impl FormulaRenderer {
    pub fn new() -> Self {
        Self
    }

    pub async fn render(
        &self,
        latex: &str,
        options: &RenderOptions,
    ) -> Result<RenderResult, String> {
        let mut mathml = None;
        let mut omml = None;
        let mut svg = None;

        for fmt in &options.formats {
            match fmt {
                RenderFormat::MathML => {
                    mathml = Some(
                        DocumentConverter::convert_latex_string(latex, OutputFormat::MathML)
                            .map_err(|e| e.to_string())?,
                    );
                }
                RenderFormat::OMML => {
                    omml = Some(
                        DocumentConverter::convert_latex_string(latex, OutputFormat::OMML)
                            .map_err(|e| e.to_string())?,
                    );
                }
                RenderFormat::SVG | RenderFormat::PNG => {
                    // SVG/PNG via MathJax frontend, not core
                }
            }
        }

        Ok(RenderResult {
            latex: latex.to_string(),
            display: options.display,
            mathml,
            omml,
            svg,
            png: None,
            warnings: vec![],
        })
    }

    #[allow(dead_code)]
    pub async fn to_mathml(&self, latex: &str, _display: bool) -> Result<String, String> {
        DocumentConverter::convert_latex_string(latex, OutputFormat::MathML)
            .map_err(|e| e.to_string())
    }

    #[allow(dead_code)]
    pub async fn to_svg(&self, _latex: &str, _display: bool) -> Result<String, String> {
        // SVG rendering requires frontend MathJax - return placeholder
        Ok(String::new())
    }
}
