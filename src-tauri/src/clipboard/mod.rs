//! Native, evidence-producing clipboard support.
//!
//! Core owns neutral transfer bundles. This module is the host boundary that
//! writes those bundles to the real system clipboard and reports each format
//! independently. A request is successful only when the operating system
//! accepted at least one requested format.

use std::collections::HashSet;

use base64::Engine;
use latexsnipper_conversion::{DocumentConverter, OutputFormat};
use latexsnipper_custom_symbols::{CustomSymbolTransferBundle, FormulaTransferBundle};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
mod windows;

const MAX_FORMAT_BYTES: usize = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;

pub const FORMAT_TEXT: &str = "text/plain";
pub const FORMAT_MARKDOWN: &str = "text/markdown";
pub const FORMAT_HTML: &str = "text/html";
pub const FORMAT_MATHML: &str = "application/mathml+xml";
pub const FORMAT_SVG: &str = "image/svg+xml";
pub const FORMAT_PNG: &str = "image/png";
pub const FORMAT_FORMULA_JSON: &str = "application/vnd.latexsnipper.formula+json";
pub const FORMAT_DRAWING_JSON: &str = "application/vnd.latexsnipper.drawing+json";
pub const FORMAT_SYMBOL_JSON: &str = "application/vnd.latexsnipper.symbol+json";
pub const FORMAT_OMML: &str = "application/vnd.latexsnipper.omml+xml";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatEvidence {
    pub format: String,
    pub bytes: u64,
    pub native_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatFailure {
    pub format: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatOmission {
    pub format: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWriteReport {
    pub success: bool,
    pub written_formats: Vec<ClipboardFormatEvidence>,
    pub failed_formats: Vec<ClipboardFormatFailure>,
    pub omitted_formats: Vec<ClipboardFormatOmission>,
    pub total_bytes: u64,
    pub clipboard_sequence: Option<u64>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCapabilities {
    pub backend: String,
    pub supported_formats: Vec<String>,
    pub multi_format: bool,
    pub system_clipboard: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardProfile {
    #[default]
    Smart,
    Office,
    Markdown,
    Image,
    LatexOnly,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFormulaBundleRequest {
    pub latex: String,
    #[serde(default)]
    pub display: bool,
    #[serde(default)]
    pub profile: ClipboardProfile,
    pub markdown: Option<String>,
    pub html: Option<String>,
    pub mathml: Option<String>,
    pub omml: Option<String>,
    pub svg: Option<String>,
    pub png_base64: Option<String>,
    pub protocol_json: Option<String>,
    pub requested_formats: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyDrawingBundleRequest {
    pub source: String,
    pub svg: Option<String>,
    pub png_base64: Option<String>,
    pub protocol_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySymbolBundleRequest {
    pub bundle: CustomSymbolTransferBundle,
}

#[derive(Debug, Clone)]
struct ClipboardPayload {
    format: &'static str,
    bytes: Vec<u8>,
}

fn conversion(latex: &str, format: OutputFormat) -> Option<String> {
    DocumentConverter::convert_latex_string(latex, format).ok()
}

fn formula_formats_for_profile(profile: ClipboardProfile) -> HashSet<&'static str> {
    match profile {
        // Smart mirrors what Ctrl/Cmd+C should offer: everything the
        // editor can reproduce, including OMML for Office hosts.
        ClipboardProfile::Smart => [
            FORMAT_TEXT,
            FORMAT_MARKDOWN,
            FORMAT_HTML,
            FORMAT_MATHML,
            FORMAT_OMML,
            FORMAT_SVG,
            FORMAT_PNG,
            FORMAT_FORMULA_JSON,
        ]
        .into_iter()
        .collect(),
        ClipboardProfile::Office => [
            FORMAT_TEXT,
            FORMAT_HTML,
            FORMAT_MATHML,
            FORMAT_OMML,
            FORMAT_SVG,
            FORMAT_PNG,
            FORMAT_FORMULA_JSON,
        ]
        .into_iter()
        .collect(),
        ClipboardProfile::Markdown => [FORMAT_TEXT, FORMAT_MARKDOWN, FORMAT_PNG]
            .into_iter()
            .collect(),
        ClipboardProfile::Image => [FORMAT_TEXT, FORMAT_SVG, FORMAT_PNG].into_iter().collect(),
        ClipboardProfile::LatexOnly => [FORMAT_TEXT].into_iter().collect(),
    }
}

fn requested_formula_formats(request: &CopyFormulaBundleRequest) -> HashSet<String> {
    request
        .requested_formats
        .as_ref()
        .map(|formats| formats.iter().cloned().collect())
        .unwrap_or_else(|| {
            formula_formats_for_profile(request.profile)
                .into_iter()
                .map(str::to_string)
                .collect()
        })
}

fn add_payload(
    payloads: &mut Vec<ClipboardPayload>,
    omissions: &mut Vec<ClipboardFormatOmission>,
    requested: &HashSet<String>,
    format: &'static str,
    content: Option<Vec<u8>>,
    missing_reason: &str,
) {
    if !requested.contains(format) {
        return;
    }
    match content {
        Some(bytes) if !bytes.is_empty() => payloads.push(ClipboardPayload { format, bytes }),
        _ => omissions.push(ClipboardFormatOmission {
            format: format.to_string(),
            reason: missing_reason.to_string(),
        }),
    }
}

fn validate_payload_sizes(
    payloads: &mut Vec<ClipboardPayload>,
    failures: &mut Vec<ClipboardFormatFailure>,
) {
    payloads.retain(|payload| {
        if payload.bytes.len() > MAX_FORMAT_BYTES {
            failures.push(ClipboardFormatFailure {
                format: payload.format.to_string(),
                code: "CLIPBOARD_PAYLOAD_TOO_LARGE".to_string(),
                message: format!(
                    "{} is {} bytes; per-format limit is {} bytes",
                    payload.format,
                    payload.bytes.len(),
                    MAX_FORMAT_BYTES
                ),
            });
            false
        } else {
            true
        }
    });

    let mut retained = 0usize;
    payloads.retain(|payload| {
        if retained.saturating_add(payload.bytes.len()) > MAX_TOTAL_BYTES {
            failures.push(ClipboardFormatFailure {
                format: payload.format.to_string(),
                code: "CLIPBOARD_PAYLOAD_TOO_LARGE".to_string(),
                message: "aggregate clipboard payload limit exceeded".to_string(),
            });
            false
        } else {
            retained += payload.bytes.len();
            true
        }
    });
}

fn write_payloads(
    mut payloads: Vec<ClipboardPayload>,
    mut omissions: Vec<ClipboardFormatOmission>,
) -> ClipboardWriteReport {
    let mut failures = Vec::new();
    validate_payload_sizes(&mut payloads, &mut failures);
    if payloads.is_empty() {
        return ClipboardWriteReport {
            success: false,
            failed_formats: failures,
            omitted_formats: omissions,
            backend: backend_name().to_string(),
            ..Default::default()
        };
    }

    #[cfg(target_os = "windows")]
    let mut report = windows::write_payloads(&payloads);

    #[cfg(not(target_os = "windows"))]
    let mut report = write_portable_bundle(&payloads);

    report.failed_formats.splice(0..0, failures);
    report.omitted_formats.append(&mut omissions);
    report.success = !report.written_formats.is_empty();
    report.total_bytes = report.written_formats.iter().map(|item| item.bytes).sum();
    report
}

/// Non-Windows backends (arboard) write a single clipboard set per
/// operation. This plan picks the most broadly useful representation:
/// HTML with a plain-text alternative, plain text, or PNG decoded into
/// an image. Formats outside that set are reported as unsupported so
/// callers can fall back to the browser clipboard API.
#[cfg(any(not(target_os = "windows"), test))]
#[derive(Debug, Default)]
struct PortableWritePlan {
    text: Option<Vec<u8>>,
    html: Option<Vec<u8>>,
    png: Option<Vec<u8>>,
    unsupported: Vec<String>,
}

#[cfg(any(not(target_os = "windows"), test))]
fn plan_portable_write(payloads: &[ClipboardPayload]) -> PortableWritePlan {
    let mut plan = PortableWritePlan::default();
    for payload in payloads {
        if payload.format == FORMAT_TEXT {
            plan.text.get_or_insert_with(|| payload.bytes.clone());
        } else if payload.format == FORMAT_HTML {
            plan.html.get_or_insert_with(|| payload.bytes.clone());
        } else if payload.format == FORMAT_PNG {
            plan.png.get_or_insert_with(|| payload.bytes.clone());
        } else {
            plan.unsupported.push(payload.format.to_string());
        }
    }
    plan
}

#[cfg(any(not(target_os = "windows"), test))]
fn write_portable_bundle(payloads: &[ClipboardPayload]) -> ClipboardWriteReport {
    let mut report = ClipboardWriteReport {
        backend: backend_name().to_string(),
        ..Default::default()
    };
    let plan = plan_portable_write(payloads);

    let mut clipboard = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(error) => {
            report.failed_formats.push(ClipboardFormatFailure {
                format: "*".to_string(),
                code: "CLIPBOARD_WRITE_FAILED".to_string(),
                message: error.to_string(),
            });
            report
                .omitted_formats
                .extend(
                    plan.unsupported
                        .iter()
                        .map(|format| ClipboardFormatOmission {
                            format: format.clone(),
                            reason: "CLIPBOARD_FORMAT_UNSUPPORTED".to_string(),
                        }),
                );
            return report;
        }
    };

    if let Some(html) = plan.html {
        let html_bytes = html.len() as u64;
        let html_text = String::from_utf8_lossy(&html).into_owned();
        let text = plan.text;
        let text_bytes = text.as_ref().map_or(0, |bytes| bytes.len() as u64);
        let alt = text
            .as_ref()
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
        match clipboard.set_html(html_text, alt) {
            Ok(()) => {
                report.written_formats.push(ClipboardFormatEvidence {
                    format: FORMAT_HTML.to_string(),
                    bytes: html_bytes,
                    native_format: native_html_name().to_string(),
                });
                if text.is_some() {
                    report.written_formats.push(ClipboardFormatEvidence {
                        format: FORMAT_TEXT.to_string(),
                        bytes: text_bytes,
                        native_format: FORMAT_TEXT.to_string(),
                    });
                }
            }
            Err(error) => {
                report.failed_formats.push(ClipboardFormatFailure {
                    format: FORMAT_HTML.to_string(),
                    code: "CLIPBOARD_WRITE_FAILED".to_string(),
                    message: error.to_string(),
                });
                if let Some(text) = text {
                    set_portable_text(&mut report, &mut clipboard, text);
                }
            }
        }
    } else if let Some(text) = plan.text {
        set_portable_text(&mut report, &mut clipboard, text);
    } else if let Some(png) = plan.png {
        match png_to_image_data(&png) {
            Some(image) => match clipboard.set_image(image) {
                Ok(()) => report.written_formats.push(ClipboardFormatEvidence {
                    format: FORMAT_PNG.to_string(),
                    bytes: png.len() as u64,
                    native_format: FORMAT_PNG.to_string(),
                }),
                Err(error) => report.failed_formats.push(ClipboardFormatFailure {
                    format: FORMAT_PNG.to_string(),
                    code: "CLIPBOARD_WRITE_FAILED".to_string(),
                    message: error.to_string(),
                }),
            },
            None => report.failed_formats.push(ClipboardFormatFailure {
                format: FORMAT_PNG.to_string(),
                code: "PNG_DECODE_FAILED".to_string(),
                message: "clipboard PNG payload could not be decoded".to_string(),
            }),
        }
    } else {
        report.failed_formats.push(ClipboardFormatFailure {
            format: "*".to_string(),
            code: "CLIPBOARD_FORMAT_UNSUPPORTED".to_string(),
            message: "this platform clipboard backend cannot write any of the requested formats"
                .to_string(),
        });
    }

    report.omitted_formats.extend(
        plan.unsupported
            .iter()
            .map(|format| ClipboardFormatOmission {
                format: format.clone(),
                reason: "CLIPBOARD_FORMAT_UNSUPPORTED".to_string(),
            }),
    );
    report
}

#[cfg(any(not(target_os = "windows"), test))]
fn set_portable_text(
    report: &mut ClipboardWriteReport,
    clipboard: &mut arboard::Clipboard,
    text: Vec<u8>,
) {
    match clipboard.set_text(String::from_utf8_lossy(&text)) {
        Ok(()) => report.written_formats.push(ClipboardFormatEvidence {
            format: FORMAT_TEXT.to_string(),
            bytes: text.len() as u64,
            native_format: FORMAT_TEXT.to_string(),
        }),
        Err(error) => report.failed_formats.push(ClipboardFormatFailure {
            format: FORMAT_TEXT.to_string(),
            code: "CLIPBOARD_WRITE_FAILED".to_string(),
            message: error.to_string(),
        }),
    }
}

#[cfg(any(not(target_os = "windows"), test))]
fn png_to_image_data(png: &[u8]) -> Option<arboard::ImageData<'static>> {
    use std::borrow::Cow;

    let image = image::load_from_memory(png).ok()?;
    let rgba = image.to_rgba8();
    let (width, height) = (rgba.width() as usize, rgba.height() as usize);
    if width == 0 || height == 0 {
        return None;
    }
    Some(arboard::ImageData {
        width,
        height,
        bytes: Cow::Owned(rgba.into_raw()),
    })
}

#[cfg(any(not(target_os = "windows"), test))]
fn native_html_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "public.html"
    } else {
        "text/html"
    }
}

fn backend_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows-win32-multiformat"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-arboard"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "linux-arboard"
    }
}

#[tauri::command]
pub fn inspect_clipboard_capabilities() -> ClipboardCapabilities {
    #[cfg(target_os = "windows")]
    let supported = vec![
        FORMAT_TEXT,
        FORMAT_MARKDOWN,
        FORMAT_HTML,
        FORMAT_MATHML,
        FORMAT_SVG,
        FORMAT_PNG,
        FORMAT_FORMULA_JSON,
        FORMAT_DRAWING_JSON,
        FORMAT_SYMBOL_JSON,
        FORMAT_OMML,
    ];
    // arboard on macOS/Linux writes a single set per operation, so the
    // browser clipboard API remains the multi-format path on those hosts.
    #[cfg(not(target_os = "windows"))]
    let supported = vec![FORMAT_TEXT, FORMAT_HTML, FORMAT_PNG];

    ClipboardCapabilities {
        backend: backend_name().to_string(),
        supported_formats: supported.into_iter().map(str::to_string).collect(),
        multi_format: cfg!(target_os = "windows"),
        system_clipboard: true,
    }
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String) -> Result<ClipboardWriteReport, String> {
    if text.is_empty() {
        return Err("CLIPBOARD_WRITE_FAILED: text is empty".to_string());
    }
    Ok(write_payloads(
        vec![ClipboardPayload {
            format: FORMAT_TEXT,
            bytes: text.into_bytes(),
        }],
        Vec::new(),
    ))
}

#[tauri::command]
pub async fn copy_formula_bundle(
    request: CopyFormulaBundleRequest,
) -> Result<ClipboardWriteReport, String> {
    if request.latex.trim().is_empty() {
        return Err("CLIPBOARD_WRITE_FAILED: formula is empty".to_string());
    }
    let requested = requested_formula_formats(&request);
    let markdown = request.markdown.or_else(|| {
        Some(if request.display {
            format!("$$\n{}\n$$", request.latex)
        } else {
            format!("${}$", request.latex)
        })
    });
    let mathml = request
        .mathml
        .or_else(|| conversion(&request.latex, OutputFormat::MathML));
    let omml = request
        .omml
        .or_else(|| conversion(&request.latex, OutputFormat::OMML));
    let html = request
        .html
        .or_else(|| conversion(&request.latex, OutputFormat::Html));

    let protocol_json = request.protocol_json.unwrap_or_else(|| {
        serde_json::json!({
            "schemaVersion": 1,
            "kind": "formula",
            "latex": request.latex,
            "display": request.display,
            "mathml": mathml,
            "omml": omml,
        })
        .to_string()
    });
    let mut neutral = FormulaTransferBundle::new(
        request.latex.clone(),
        markdown.clone().unwrap_or_default(),
        protocol_json.clone(),
    );
    neutral.mathml.clone_from(&mathml);
    neutral.omml.clone_from(&omml);
    neutral.html.clone_from(&html);
    neutral
        .validate()
        .map_err(|error| format!("CLIPBOARD_WRITE_FAILED: {error}"))?;

    let mut payloads = Vec::new();
    let mut omissions = Vec::new();
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_TEXT,
        Some(request.latex.into_bytes()),
        "LATEX_MISSING",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_MARKDOWN,
        markdown.map(String::into_bytes),
        "MARKDOWN_CONVERSION_FAILED",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_HTML,
        html.map(String::into_bytes),
        "HTML_CONVERSION_FAILED",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_MATHML,
        mathml.map(String::into_bytes),
        "MATHML_CONVERSION_FAILED",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_OMML,
        omml.map(String::into_bytes),
        "OMML_CONVERSION_FAILED",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_SVG,
        request.svg.map(String::into_bytes),
        "SVG_RENDER_NOT_PROVIDED",
    );
    let png = request.png_base64.and_then(|value| {
        base64::engine::general_purpose::STANDARD
            .decode(value.trim_start_matches("data:image/png;base64,"))
            .ok()
    });
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_PNG,
        png,
        "PNG_RENDER_NOT_PROVIDED",
    );
    add_payload(
        &mut payloads,
        &mut omissions,
        &requested,
        FORMAT_FORMULA_JSON,
        Some(protocol_json.into_bytes()),
        "FORMULA_PROTOCOL_MISSING",
    );
    Ok(write_payloads(payloads, omissions))
}

#[tauri::command]
pub async fn copy_drawing_bundle(
    request: CopyDrawingBundleRequest,
) -> Result<ClipboardWriteReport, String> {
    if request.source.trim().is_empty() {
        return Err("CLIPBOARD_WRITE_FAILED: drawing source is empty".to_string());
    }
    let png = request.png_base64.and_then(|value| {
        base64::engine::general_purpose::STANDARD
            .decode(value.trim_start_matches("data:image/png;base64,"))
            .ok()
    });
    let mut payloads = vec![
        ClipboardPayload {
            format: FORMAT_TEXT,
            bytes: request.source.into_bytes(),
        },
        ClipboardPayload {
            format: FORMAT_DRAWING_JSON,
            bytes: request.protocol_json.into_bytes(),
        },
    ];
    let mut omissions = Vec::new();
    if let Some(svg) = request.svg {
        payloads.push(ClipboardPayload {
            format: FORMAT_SVG,
            bytes: svg.into_bytes(),
        });
    } else {
        omissions.push(ClipboardFormatOmission {
            format: FORMAT_SVG.to_string(),
            reason: "SVG_RENDER_NOT_PROVIDED".to_string(),
        });
    }
    if let Some(png) = png {
        payloads.push(ClipboardPayload {
            format: FORMAT_PNG,
            bytes: png,
        });
    } else {
        omissions.push(ClipboardFormatOmission {
            format: FORMAT_PNG.to_string(),
            reason: "PNG_RENDER_NOT_PROVIDED".to_string(),
        });
    }
    Ok(write_payloads(payloads, omissions))
}

#[tauri::command]
pub async fn copy_symbol_bundle(
    request: CopySymbolBundleRequest,
) -> Result<ClipboardWriteReport, String> {
    request
        .bundle
        .validate()
        .map_err(|error| format!("SYMBOL_ASSET_INVALID: {error}"))?;
    let svg = base64::engine::general_purpose::STANDARD
        .decode(&request.bundle.svg.data_base64)
        .map_err(|error| format!("SYMBOL_ASSET_INVALID: {error}"))?;
    let mut payloads = vec![
        ClipboardPayload {
            format: FORMAT_TEXT,
            bytes: request.bundle.latex_fallback.clone().into_bytes(),
        },
        ClipboardPayload {
            format: FORMAT_SVG,
            bytes: svg,
        },
        ClipboardPayload {
            format: FORMAT_SYMBOL_JSON,
            bytes: request.bundle.protocol_json.clone().into_bytes(),
        },
    ];
    let mut omissions = Vec::new();
    if let Some(png) = &request.bundle.png {
        match base64::engine::general_purpose::STANDARD.decode(&png.data_base64) {
            Ok(bytes) => payloads.push(ClipboardPayload {
                format: FORMAT_PNG,
                bytes,
            }),
            Err(error) => omissions.push(ClipboardFormatOmission {
                format: FORMAT_PNG.to_string(),
                reason: format!("SYMBOL_ASSET_INVALID: {error}"),
            }),
        }
    }
    Ok(write_payloads(payloads, omissions))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_selection_is_explicit() {
        let smart = formula_formats_for_profile(ClipboardProfile::Smart);
        assert!(smart.contains(FORMAT_FORMULA_JSON));
        assert!(smart.contains(FORMAT_OMML));
        let office = formula_formats_for_profile(ClipboardProfile::Office);
        assert!(office.contains(FORMAT_OMML));
    }

    #[test]
    fn portable_plan_prefers_html_with_text_alt() {
        let plan = plan_portable_write(&[
            ClipboardPayload {
                format: FORMAT_PNG,
                bytes: vec![1],
            },
            ClipboardPayload {
                format: FORMAT_TEXT,
                bytes: b"x".to_vec(),
            },
            ClipboardPayload {
                format: FORMAT_HTML,
                bytes: b"<b>y</b>".to_vec(),
            },
            ClipboardPayload {
                format: FORMAT_OMML,
                bytes: b"<m:oMath/>".to_vec(),
            },
        ]);
        assert_eq!(plan.text.as_deref(), Some(&b"x"[..]));
        assert_eq!(plan.html.as_deref(), Some(&b"<b>y</b>"[..]));
        assert_eq!(plan.png.as_deref(), Some(&[1][..]));
        assert_eq!(plan.unsupported, vec![FORMAT_OMML.to_string()]);
    }

    #[test]
    fn portable_plan_marks_every_unwritable_format() {
        let plan = plan_portable_write(&[
            ClipboardPayload {
                format: FORMAT_SVG,
                bytes: b"<svg/>".to_vec(),
            },
            ClipboardPayload {
                format: FORMAT_MATHML,
                bytes: b"<math/>".to_vec(),
            },
        ]);
        assert!(plan.text.is_none());
        assert!(plan.html.is_none());
        assert!(plan.png.is_none());
        assert_eq!(plan.unsupported.len(), 2);
    }

    #[test]
    fn portable_plan_takes_first_text_only() {
        let plan = plan_portable_write(&[ClipboardPayload {
            format: FORMAT_TEXT,
            bytes: b"a".to_vec(),
        }]);
        assert_eq!(plan.text.as_deref(), Some(&b"a"[..]));
        assert!(plan.html.is_none());
        assert!(plan.png.is_none());
        assert!(plan.unsupported.is_empty());
    }

    #[test]
    fn empty_payload_never_reports_success() {
        let report = write_payloads(Vec::new(), Vec::new());
        assert!(!report.success);
        assert!(report.written_formats.is_empty());
    }

    #[test]
    fn oversized_payload_is_rejected_per_format() {
        let mut payloads = vec![ClipboardPayload {
            format: FORMAT_PNG,
            bytes: vec![0; MAX_FORMAT_BYTES + 1],
        }];
        let mut failures = Vec::new();
        validate_payload_sizes(&mut payloads, &mut failures);
        assert!(payloads.is_empty());
        assert_eq!(failures[0].code, "CLIPBOARD_PAYLOAD_TOO_LARGE");
    }
}
