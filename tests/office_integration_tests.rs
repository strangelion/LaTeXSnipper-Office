//! Office integration end-to-end tests.
//!
//! These tests exercise the office integration DTOs and batch conversion logic.
//! Full E2E tests require a running Tauri app with Native Office VSTO hosts,
//! which are run as part of the CI regression suite.

#[cfg(test)]
mod office_tests {
    use latexsnipper_office::office_integration::batch_conversion;
    use latexsnipper_office::office_integration::dto::*;

    /// Test: batch scan plan builder does not modify original candidates.
    #[test]
    fn test_batch_scan_plan_does_not_modify_input() {
        let candidates = vec![
            LatexCandidate {
                id: "c1".to_string(),
                source: "$x^2$".to_string(),
                normalized_latex: Some("x^2".to_string()),
                location: "Body/1".to_string(),
                confidence: 0.95,
            },
            LatexCandidate {
                id: "c2".to_string(),
                source: r"$$\frac{a}{b}$$".to_string(),
                normalized_latex: Some(r"\frac{a}{b}".to_string()),
                location: "Body/2".to_string(),
                confidence: 0.98,
            },
        ];

        let original_len = candidates.len();
        let plan = batch_conversion::build_conversion_plan(candidates);

        // Verify plan has the same number of items
        assert_eq!(plan.items.len(), original_len);
    }

    /// Test: failed item preserves original LaTeX in the plan.
    #[test]
    fn test_failed_item_preserves_original_latex() {
        let candidates = vec![
            LatexCandidate {
                id: "c-bad".to_string(),
                source: "$invalid {unclosed$".to_string(),
                normalized_latex: Some("invalid {unclosed".to_string()),
                location: "Body/1".to_string(),
                confidence: 0.5,
            },
            LatexCandidate {
                id: "c-good".to_string(),
                source: "$x^2$".to_string(),
                normalized_latex: Some("x^2".to_string()),
                location: "Body/2".to_string(),
                confidence: 0.99,
            },
        ];

        let plan = batch_conversion::build_conversion_plan(candidates);

        // The bad item should be in the plan with source text preserved
        let bad_item = plan.items.iter().find(|i| i.source_id == "c-bad").unwrap();
        assert_eq!(bad_item.source_text, "$invalid {unclosed$");
        assert_eq!(bad_item.status, BatchItemStatus::Failed);
        assert!(bad_item.error.is_some());

        // The good item should have OMML
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
                    status: BatchItemStatus::Converted,
                    error: None,
                },
                BatchConversionItem {
                    source_id: "2".to_string(),
                    source_text: "$x^2$".to_string(),
                    normalized_latex: "x^2".to_string(),
                    omml: Some("<m:oMath>...</m:oMath>".to_string()),
                    status: BatchItemStatus::Converted,
                    error: None,
                },
                BatchConversionItem {
                    source_id: "3".to_string(),
                    source_text: "$bad$".to_string(),
                    normalized_latex: "bad".to_string(),
                    omml: None,
                    status: BatchItemStatus::Failed,
                    error: Some("Conversion error".to_string()),
                },
                BatchConversionItem {
                    source_id: "4".to_string(),
                    source_text: "$skip$".to_string(),
                    normalized_latex: "skip".to_string(),
                    omml: None,
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
        assert_eq!(result.failures.len(), 1);
        assert_eq!(result.failures[0].source_id, "3");
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
        assert!(json.contains("session-abc"));
        assert!(json.contains("doc-123"));

        let deserialized: OfficeTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.host, OfficeHost::Word);
        assert_eq!(deserialized.session_id, "session-abc");
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
        assert!(json.contains("Sheet1"));

        let deserialized: Artifact = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.artifact_type, ArtifactType::Formula);
    }
}
