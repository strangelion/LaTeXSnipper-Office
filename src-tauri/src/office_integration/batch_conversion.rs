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
        let omml_result = latexsnipper_conversion::DocumentConverter::convert_latex_string(
            &latex,
            latexsnipper_conversion::OutputFormat::OMML,
        );

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
