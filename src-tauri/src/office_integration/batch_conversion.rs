//! Office batch conversion service.
//!
//! Coordinates the batch LaTeX→OMML conversion pipeline:
//!   1. Scan Office document for LaTeX candidates (done by VSTO)
//!   2. Normalize and validate LaTeX
//!   3. Convert to OMML via latexsnipper-core
//!   4. Build a conversion plan
//!   5. Execute via Native Office pipe

use super::dto::*;

/// Build a batch conversion plan from Latex candidates.
///
/// Each candidate is run through the Core LaTeX→OMML converter.
/// Failed conversions are recorded as Failed items (not skipped)
/// so the caller gets a complete picture.
pub fn build_conversion_plan(
    candidates: Vec<LatexCandidate>,
) -> Result<BatchConversionPlan, String> {
    let plan_id = generate_plan_id();
    let mut items = Vec::with_capacity(candidates.len());

    for candidate in candidates {
        // If already normalized, use it; otherwise use the source
        let latex = candidate
            .normalized_latex
            .unwrap_or_else(|| candidate.source.clone());

        // Compute source hash for integrity verification
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(candidate.source.as_bytes());
        let source_hash = format!("{:x}", hasher.finalize());

        // Try OMML conversion
        let omml_result =
            latexsnipper_conversion::omml::validate_omml_latex(&latex).and_then(|()| {
                latexsnipper_conversion::DocumentConverter::convert_latex_string(
                    &latex,
                    latexsnipper_conversion::OutputFormat::OMML,
                )
                .map_err(|error| error.to_string())
            });

        match omml_result {
            Ok(omml) => {
                items.push(BatchConversionItem {
                    source_id: candidate.id,
                    source_text: candidate.source,
                    normalized_latex: latex,
                    omml: Some(omml),
                    locator: candidate.locator,
                    source_hash: Some(source_hash),
                    status: BatchItemStatus::Converted,
                    error: None,
                });
            }
            Err(error) => {
                items.push(BatchConversionItem {
                    source_id: candidate.id,
                    source_text: candidate.source,
                    normalized_latex: latex,
                    omml: None,
                    locator: candidate.locator,
                    source_hash: Some(source_hash),
                    status: BatchItemStatus::Failed,
                    error: Some(format!("OMML conversion failed: {error}")),
                });
            }
        }
    }

    Ok(BatchConversionPlan {
        id: plan_id,
        target: None,
        items,
    })
}

/// Compute a summary result from a completed plan.
#[allow(dead_code)]
pub fn compute_batch_result(plan: &BatchConversionPlan) -> BatchConversionResult {
    let total = plan.items.len();
    let converted = plan
        .items
        .iter()
        .filter(|i| i.status == BatchItemStatus::Converted)
        .count();
    let skipped = plan
        .items
        .iter()
        .filter(|i| i.status == BatchItemStatus::Skipped)
        .count();
    let failed = plan
        .items
        .iter()
        .filter(|i| i.status == BatchItemStatus::Failed)
        .count();

    let failures: Vec<BatchFailure> = plan
        .items
        .iter()
        .filter(|i| i.status == BatchItemStatus::Failed)
        .map(|i| BatchFailure {
            source_id: i.source_id.clone(),
            source_text: i.source_text.clone(),
            error: i.error.clone().unwrap_or_default(),
        })
        .collect();

    BatchConversionResult {
        total,
        converted,
        skipped,
        failed,
        failures,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn generate_plan_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("plan-{:x}", t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(id: &str, source: &str) -> LatexCandidate {
        LatexCandidate {
            id: id.into(),
            source: source.into(),
            normalized_latex: None,
            location: "test selection".into(),
            locator: Some(serde_json::json!({ "testId": id })),
            source_hash: None,
            confidence: 1.0,
        }
    }

    #[test]
    fn unsupported_layout_does_not_abort_valid_batch_candidates() {
        let source = r"\begin{align*}x&=1\\y&=2\end{align*}";
        let plan = build_conversion_plan(vec![
            candidate("before", r"\frac{1}{2}"),
            candidate("starred", source),
            candidate("after", r"\sqrt{x}"),
        ])
        .unwrap();
        assert_eq!(plan.items.len(), 3);
        assert_eq!(plan.items[0].status, BatchItemStatus::Converted);
        assert_eq!(plan.items[1].status, BatchItemStatus::Failed);
        assert_eq!(plan.items[2].status, BatchItemStatus::Converted);
        assert!(plan.items[1].omml.is_none());
        assert_eq!(plan.items[1].source_text, source);
        assert_eq!(plan.items[1].normalized_latex, source);
        assert_eq!(
            plan.items[1].locator,
            Some(serde_json::json!({ "testId": "starred" }))
        );
        assert!(plan.items[1]
            .error
            .as_deref()
            .unwrap()
            .contains("starred alignment"));
        use sha2::{Digest, Sha256};
        assert_eq!(
            plan.items[1].source_hash.as_deref().unwrap(),
            format!("{:x}", Sha256::digest(source.as_bytes()))
        );
        let summary = compute_batch_result(&plan);
        assert_eq!(
            (
                summary.total,
                summary.converted,
                summary.failed,
                summary.skipped
            ),
            (3, 2, 1, 0)
        );
        assert_eq!(summary.failures[0].source_id, "starred");
        assert_eq!(summary.failures[0].source_text, source);
    }
}
