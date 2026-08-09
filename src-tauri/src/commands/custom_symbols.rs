use base64::Engine;
use latexsnipper_custom_symbols::{
    BinaryArtifact, CustomMathSymbol, CustomSymbolTransferBundle, ImportParameters,
    MathGlyphComposition, MathGlyphMetrics, MathSymbolClass, SymbolAssetRef, SymbolProvenance,
};
use latexsnipper_drawing::{
    DrawingCompileService, DrawingDocument, DrawingSecurityPolicy, DrawingSourceLanguage,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCustomSymbolRequest {
    pub id: String,
    pub name: String,
    pub latex_command: Option<String>,
    pub aliases: Vec<String>,
    pub math_class: MathSymbolClass,
    pub composition: MathGlyphComposition,
    pub svg: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCustomSymbolResponse {
    pub bundle: CustomSymbolTransferBundle,
    pub metrics: MathGlyphMetrics,
    pub canonical_svg: String,
}

fn build_custom_symbol(
    request: BuildCustomSymbolRequest,
) -> Result<BuildCustomSymbolResponse, String> {
    let id = request.id.trim();
    let name = request.name.trim();
    if id.is_empty() || name.is_empty() {
        return Err("SYMBOL_METADATA_INVALID: id and name are required".to_owned());
    }
    request
        .composition
        .validate(id)
        .map_err(|error| format!("SYMBOL_COMPOSITION_INVALID: {error}"))?;
    let metrics = request
        .composition
        .recompute_metrics(&MathGlyphMetrics::default())
        .map_err(|error| format!("SYMBOL_METRICS_INVALID: {error}"))?;

    let document = DrawingDocument::source_only(
        format!("custom-symbol-{id}"),
        DrawingSourceLanguage::SvgSource,
        request.svg,
    );
    let artifact = DrawingCompileService
        .compile_svg(
            &document,
            "latexsnipper-custom-symbol-composer@1",
            None,
            &DrawingSecurityPolicy::default(),
        )
        .map_err(|error| format!("SYMBOL_SVG_INVALID: {error}"))?;
    let canonical_svg = String::from_utf8(artifact.bytes.clone())
        .map_err(|error| format!("SYMBOL_SVG_INVALID: {error}"))?;
    let asset = SymbolAssetRef {
        sha256: artifact.artifact.sha256.clone(),
        mime_type: "image/svg+xml".to_owned(),
        byte_length: artifact.bytes.len(),
    };
    let provenance = SymbolProvenance {
        source_asset_sha256: artifact.artifact.sha256.clone(),
        canonical_asset_sha256: artifact.artifact.sha256.clone(),
        import_parameters: ImportParameters {
            sniffed_mime_type: "image/svg+xml".to_owned(),
            cropped_to_ink: false,
            background_removed: false,
            original_width: 1000,
            original_height: 1000,
        },
        imported_from: Some("visual-composer".to_owned()),
    };
    let mut symbol = CustomMathSymbol::new(
        id,
        name,
        request.math_class,
        asset.clone(),
        asset,
        metrics.clone(),
        provenance,
    );
    symbol.aliases = request
        .aliases
        .into_iter()
        .map(|alias| alias.trim().to_owned())
        .filter(|alias| !alias.is_empty())
        .collect();
    symbol.latex_command = request
        .latex_command
        .map(|command| command.trim().to_owned())
        .filter(|command| !command.is_empty());
    symbol.composition = Some(request.composition);
    symbol
        .validate()
        .map_err(|error| format!("SYMBOL_ASSET_INVALID: {error}"))?;

    let protocol_json = serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "kind": "customSymbol",
        "symbol": &symbol,
    }))
    .map_err(|error| format!("SYMBOL_PROTOCOL_INVALID: {error}"))?;
    let svg = BinaryArtifact {
        mime_type: "image/svg+xml".to_owned(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(&artifact.bytes),
        sha256: artifact.artifact.sha256,
    };
    let fallback = symbol
        .latex_command
        .clone()
        .unwrap_or_else(|| symbol.name.clone());
    let bundle = CustomSymbolTransferBundle::new(symbol, svg, protocol_json, fallback);
    bundle
        .validate()
        .map_err(|error| format!("SYMBOL_ASSET_INVALID: {error}"))?;
    Ok(BuildCustomSymbolResponse {
        bundle,
        metrics,
        canonical_svg,
    })
}

#[tauri::command]
pub async fn build_custom_symbol_bundle(
    request: BuildCustomSymbolRequest,
) -> Result<BuildCustomSymbolResponse, String> {
    build_custom_symbol(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use latexsnipper_custom_symbols::{
        CompositionLayer, CompositionLayerSource, CompositionTransform, DrawingPrimitive,
        GlyphBoundingBox,
    };

    fn request(svg: &str) -> BuildCustomSymbolRequest {
        BuildCustomSymbolRequest {
            id: "visual-symbol".to_owned(),
            name: "Visual symbol".to_owned(),
            latex_command: Some("\\visualsymbol".to_owned()),
            aliases: vec!["visual".to_owned()],
            math_class: MathSymbolClass::Ordinary,
            composition: MathGlyphComposition {
                layers: vec![CompositionLayer {
                    layer_id: "rectangle".to_owned(),
                    name: "Rectangle".to_owned(),
                    source: CompositionLayerSource::Primitive {
                        primitive: DrawingPrimitive::Rectangle {
                            bounds: GlyphBoundingBox {
                                min_x: 100.0,
                                min_y: 100.0,
                                max_x: 600.0,
                                max_y: 700.0,
                            },
                            corner_radius: 20.0,
                            stroke_width: 10.0,
                            filled: false,
                        },
                    },
                    transform: CompositionTransform::default(),
                    opacity: 1.0,
                    color: None,
                    z_index: 0,
                    visible: true,
                }],
                ..MathGlyphComposition::default()
            },
            svg: svg.to_owned(),
        }
    }

    #[test]
    fn composer_builds_core_validated_transfer_bundle() {
        let response = build_custom_symbol(request(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect x="100" y="100" width="500" height="600" fill="none" stroke="currentColor" stroke-width="10"/></svg>"#,
        ))
        .unwrap();
        assert_eq!(response.bundle.symbol.id, "visual-symbol");
        assert!(response.bundle.symbol.composition.is_some());
        assert_eq!(response.metrics.advance_width, 510.0);
        assert!(response.canonical_svg.contains("viewBox"));
    }

    #[test]
    fn composer_rejects_active_svg_content() {
        let error = build_custom_symbol(request(
            r#"<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>"#,
        ))
        .unwrap_err();
        assert!(error.contains("SYMBOL_SVG_INVALID"));
    }

    #[test]
    fn composer_preserves_core_validated_latex_layers() {
        let mut formula_request = request(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><path d="M250 500 L750 500" fill="none" stroke="currentColor" stroke-width="16"/></svg>"#,
        );
        formula_request.composition.layers[0].source = CompositionLayerSource::Formula {
            latex: r"\overset{\star}{\longrightarrow}".to_owned(),
            metrics_snapshot: MathGlyphMetrics::default(),
        };
        let response = build_custom_symbol(formula_request).unwrap();
        let composition = response.bundle.symbol.composition.unwrap();
        assert!(matches!(
            composition.layers[0].source,
            CompositionLayerSource::Formula { .. }
        ));
    }
}
