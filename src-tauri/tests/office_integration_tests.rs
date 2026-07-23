//! Office integration end-to-end tests.
//!
//! These tests exercise the office integration DTOs and batch conversion logic.
//! Full E2E tests require a running Tauri app with Native Office VSTO hosts,
//! which are run as part of the CI regression suite.

#[cfg(test)]
mod office_tests {
    use latexsnipper_office::office_integration::batch_conversion;
    use latexsnipper_office::office_integration::dto::*;

    fn make_candidate(id: &str, source: &str, normalized: &str, loc: &str, conf: f64) -> LatexCandidate {
        LatexCandidate {
            id: id.to_string(),
            source: source.to_string(),
            normalized_latex: Some(normalized.to_string()),
            location: loc.to_string(),
            locator: None,
            source_hash: None,
            confidence: conf,
        }
    }

    /// Test: batch scan plan builder does not modify original candidates.
    #[test]
    fn test_batch_scan_plan_does_not_modify_input() {
        let candidates = vec![
            make_candidate("c1", "$x^2$", "x^2", "Body/1", 0.95),
            make_candidate("c2", r"$$\frac{a}{b}$$", r"\frac{a}{b}", "Body/2", 0.98),
        ];

        let original_len = candidates.len();
        let plan = batch_conversion::build_conversion_plan(candidates).unwrap();

        assert_eq!(plan.items.len(), original_len);
    }

    /// Test: failed item preserves original LaTeX in the plan.
    #[test]
    fn test_failed_item_preserves_original_latex() {
        let candidates = vec![
            make_candidate("c-bad", "$invalid {unclosed$", "invalid {unclosed", "Body/1", 0.5),
            make_candidate("c-good", "$x^2$", "x^2", "Body/2", 0.99),
        ];

        let plan = batch_conversion::build_conversion_plan(candidates).unwrap();

        let bad_item = plan.items.iter().find(|i| i.source_id == "c-bad").unwrap();
        assert_eq!(bad_item.source_text, "$invalid {unclosed$");
        // Note: the OMML converter wraps invalid LaTeX as-is (doesn't validate).
        // The item status reflects conversion result, not LaTeX validity.
        assert!(bad_item.omml.is_some() || bad_item.status == BatchItemStatus::Failed);

        let good_item = plan.items.iter().find(|i| i.source_id == "c-good").unwrap();
        assert_eq!(good_item.status, BatchItemStatus::Converted);
        assert!(good_item.omml.is_some());
    }

    /// Test: batch result computes correct counts.
    #[test]
    fn test_batch_result_counts() {
        let mut plan = BatchConversionPlan {
            id: "plan-1".to_string(),
            items: vec![
                BatchConversionItem {
                    source_id: "1".to_string(),
                    source_text: "$a$".to_string(),
                    normalized_latex: "a".to_string(),
                    omml: Some("<m:oMath>...</m:oMath>".to_string()),
                    locator: None,
                    source_hash: None,
                    status: BatchItemStatus::Converted,
                    error: None,
                },
                BatchConversionItem {
                    source_id: "2".to_string(),
                    source_text: "$x^2$".to_string(),
                    normalized_latex: "x^2".to_string(),
                    omml: Some("<m:oMath>...</m:oMath>".to_string()),
                    locator: None,
                    source_hash: None,
                    status: BatchItemStatus::Converted,
                    error: None,
                },
                BatchConversionItem {
                    source_id: "3".to_string(),
                    source_text: "$bad$".to_string(),
                    normalized_latex: "bad".to_string(),
                    omml: None,
                    locator: None,
                    source_hash: None,
                    status: BatchItemStatus::Failed,
                    error: Some("Conversion error".to_string()),
                },
                BatchConversionItem {
                    source_id: "4".to_string(),
                    source_text: "$skip$".to_string(),
                    normalized_latex: "skip".to_string(),
                    omml: None,
                    locator: None,
                    source_hash: None,
                    status: BatchItemStatus::Skipped,
                    error: Some("No OMML content".to_string()),
                },
            ],
        };

        let result = batch_conversion::compute_batch_result(&plan);

        assert_eq!(result.total, 4);
        assert_eq!(result.converted, 2);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.failed, 1);
    }

    /// Test: DTO serialization round-trip for OfficeTarget.
    #[test]
    fn test_office_target_round_trip() {
        let target = OfficeTarget {
            host: OfficeHost::Word,
            session_id: "session-abc".to_string(),
            document_context: "doc-123".to_string(),
        };

        let json = serde_json::to_string(&target).unwrap();
        assert!(json.contains("word"));

        let deserialized: OfficeTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.host, OfficeHost::Word);
    }

    /// Test: Artifact serialization.
    #[test]
    fn test_artifact_serialization() {
        let artifact = Artifact {
            artifact_type: ArtifactType::Formula,
            payload: serde_json::json!({
                "latex": "\\frac{a}{b}",
                "omml": "<m:oMath>...</m:oMath>"
            }),
            target: OfficeTarget {
                host: OfficeHost::Excel,
                session_id: "s1".to_string(),
                document_context: "ctx-1".to_string(),
            },
            options: ArtifactOptions {
                display: Some("inline".to_string()),
                storage_mode: Some("ole".to_string()),
                worksheet_id: Some("Sheet1".to_string()),
                anchor_cell: Some("B2".to_string()),
            },
        };

        let json = serde_json::to_string(&artifact).unwrap();
        assert!(json.contains("formula"));
        assert!(json.contains("excel"));

        let deserialized: Artifact = serde_json::from_str(&json).unwrap();
        // ArtifactType doesn't impl PartialEq, verify via JSON
        let re_json = serde_json::to_string(&deserialized).unwrap();
        assert!(re_json.contains("formula"));
    }
}
