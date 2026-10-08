//! Read-only PNG source candidates for the native Word selection workflow.
use base64::Engine;
use latexsnipper_conversion::formula_source_probe::SourceFormat;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_PNG_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub format: String,
    pub source: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResult {
    pub success: bool,
    pub conflict: bool,
    pub candidates: Vec<Candidate>,
    pub error_code: Option<String>,
}

pub fn inspect(encoded: &str, expected_hash: &str) -> SourceResult {
    match candidates(encoded, expected_hash) {
        Ok(result) => result,
        Err(code) => SourceResult {
            error_code: Some(code.into()),
            ..Default::default()
        },
    }
}

fn candidates(encoded: &str, expected_hash: &str) -> Result<SourceResult, &'static str> {
    if encoded.len() > MAX_PNG_BYTES.div_ceil(3) * 4 || expected_hash.len() != 64 {
        return Err("PNG_SOURCE_LIMIT");
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine.decode(encoded).map_err(|_| "PNG_SOURCE_ENCODING")?;
    if bytes.len() > MAX_PNG_BYTES || engine.encode(&bytes) != encoded {
        return Err("PNG_SOURCE_ENCODING");
    }
    if format!("{:x}", Sha256::digest(&bytes)) != expected_hash {
        return Err("PNG_SOURCE_IDENTITY");
    }
    let report = latexsnipper_conversion::png_formula_source::inspect_png_formula_sources(&bytes)
        .map_err(|_| "PNG_SOURCE_REJECTED")?;
    let mut candidates = Vec::new();
    for source in report.sources {
        let format = match source.format {
            SourceFormat::Latex => "latex",
            SourceFormat::Mathml => "mathml",
            SourceFormat::Omml => "omml",
        };
        let chunk = String::from_utf8_lossy(&source.chunk_type);
        let provenance = format!(
            "{chunk} / {} / {}..{}",
            source.keyword, source.chunk_span.start, source.chunk_span.end
        );
        candidates.push(Candidate {
            format: format.into(),
            source: source.source,
            provenance: provenance.clone(),
        });
        for annotation in source.latex_annotations {
            candidates.push(Candidate {
                format: "latex".into(),
                source: annotation.source,
                provenance: format!("{provenance} / MathML annotation"),
            });
        }
    }
    Ok(SourceResult {
        success: true,
        conflict: !report.conflicting_formats.is_empty(),
        candidates,
        error_code: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    fn crc(bytes: &[u8]) -> u32 {
        let mut result = !0u32;
        for byte in bytes {
            result ^= u32::from(*byte);
            for _ in 0..8 {
                result = (result >> 1) ^ (0xedb88320 & (0u32.wrapping_sub(result & 1)));
            }
        }
        !result
    }
    fn png(fields: &[&[u8]]) -> Vec<u8> {
        let mut image = Vec::new();
        image::codecs::png::PngEncoder::new(&mut image)
            .write_image(&[255], 1, 1, image::ExtendedColorType::L8)
            .unwrap();
        let iend = image.split_off(image.len() - 12);
        for field in fields {
            image.extend((field.len() as u32).to_be_bytes());
            let start = image.len();
            image.extend(b"tEXt");
            image.extend(*field);
            image.extend(crc(&image[start..]).to_be_bytes());
        }
        image.extend(iend);
        image
    }

    #[test]
    fn reads_png_candidates_and_conflict_without_selecting_one() {
        let bytes = png(&[b"latex\0x^2", b"latex\0y^2"]);
        let result = inspect(
            &base64::engine::general_purpose::STANDARD.encode(&bytes),
            &format!("{:x}", Sha256::digest(&bytes)),
        );
        assert!(result.success && result.conflict);
        assert_eq!(result.candidates.len(), 2);
        assert_eq!(result.candidates[0].source, "x^2");
        assert!(result.candidates[1]
            .provenance
            .starts_with("tEXt / latex / "));
    }

    #[test]
    fn rejects_bad_encoding_stale_carrier_and_metadata_without_partial_results() {
        let bytes = png(&[]);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        assert_eq!(
            inspect(&encoded, &"a".repeat(64)).error_code.as_deref(),
            Some("PNG_SOURCE_IDENTITY")
        );
        assert_eq!(
            inspect("bad", &"a".repeat(64)).error_code.as_deref(),
            Some("PNG_SOURCE_ENCODING")
        );
        assert_eq!(
            inspect(
                &"a".repeat(MAX_PNG_BYTES.div_ceil(3) * 4 + 1),
                &"a".repeat(64)
            )
            .error_code
            .as_deref(),
            Some("PNG_SOURCE_LIMIT")
        );
        let result = inspect(&encoded, &format!("{:x}", Sha256::digest(&bytes)));
        assert!(result.success && result.candidates.is_empty());
        let bytes = png(&[b"latex\0valid", b"omml\0<math/>"]);
        let result = inspect(
            &base64::engine::general_purpose::STANDARD.encode(&bytes),
            &format!("{:x}", Sha256::digest(&bytes)),
        );
        assert!(!result.success && result.candidates.is_empty());
        assert_eq!(result.error_code.as_deref(), Some("PNG_SOURCE_REJECTED"));
    }

    #[test]
    fn preserves_mathml_and_explicit_tex_annotation_as_separate_candidates() {
        let mut payload = b"mathml\0".to_vec();
        payload.extend(br#"<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>"#);
        let bytes = png(&[&payload]);
        let result = inspect(
            &base64::engine::general_purpose::STANDARD.encode(&bytes),
            &format!("{:x}", Sha256::digest(&bytes)),
        );
        assert!(result.success && !result.conflict);
        assert_eq!(result.candidates[0].format, "mathml");
        assert_eq!(result.candidates[1].source, "x");
        assert_eq!(result.candidates[1].format, "latex");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn response_wire_is_flat_and_matches_csharp() {
        let message = crate::platforms::pipe_protocol::DesktopMessage::PngSourceResult {
            requestId: "r".into(),
            sessionId: "s".into(),
            documentContextId: "d".into(),
            carrierSha256: "a".repeat(64),
            result: SourceResult {
                success: true,
                candidates: vec![Candidate {
                    format: "latex".into(),
                    source: "x".into(),
                    provenance: "tEXt".into(),
                }],
                ..Default::default()
            },
        };
        let wire = serde_json::to_value(message).unwrap();
        assert_eq!(wire["type"], "PNG_SOURCE_RESULT");
        assert_eq!(wire["candidates"][0]["source"], "x");
        assert!(wire.get("result").is_none());
        assert_eq!(wire["documentContextId"], "d");
    }
}
