export const AUTO_INSERT_CONFIDENCE_THRESHOLD = 0.9;

const FORMULA_INSERT_HOSTS = new Set([
  "word",
  "excel",
  "powerpoint",
  "officejs",
  "wps-writer",
  "wps-spreadsheets",
  "wps-presentation",
]);

/**
 * Build the auditable auto-insert decision. Every failure is additive so the
 * editor can explain why manual review is required.
 */
export function decideAutoInsert({
  userEnabled,
  protocolRequested,
  targetSessionId,
  targetHost,
  expectedDocumentContext,
  currentDocumentContext,
  acceptance,
  output,
  confidenceThreshold = AUTO_INSERT_CONFIDENCE_THRESHOLD,
}) {
  const reasons = [];
  const host = String(targetHost || "").toLowerCase();

  if (userEnabled !== true) reasons.push("USER_AUTO_INSERT_DISABLED");
  if (protocolRequested !== true)
    reasons.push("REQUEST_DID_NOT_ENABLE_AUTO_INSERT");
  if (!targetSessionId) reasons.push("OFFICE_SESSION_MISSING");
  if (!expectedDocumentContext || !currentDocumentContext) {
    reasons.push("DOCUMENT_CONTEXT_UNVERIFIED");
  } else if (expectedDocumentContext !== currentDocumentContext) {
    reasons.push("DOCUMENT_CONTEXT_CHANGED");
  }
  if (!acceptance?.technicallyValid) reasons.push("CORE_NOT_TECHNICALLY_READY");
  if (
    acceptance?.qualityStatus === "unknown" ||
    acceptance?.qualityStatus === "baselineFailed" ||
    acceptance?.qualityStatus === "baselineMissing"
  ) {
    reasons.push("MODEL_QUALITY_NOT_VALIDATED");
  }
  if (acceptance?.qualityStatus === "experimental") {
    reasons.push("MODEL_QUALITY_EXPERIMENTAL");
  }
  if (!String(output || "").trim()) reasons.push("OUTPUT_EMPTY");
  if (!acceptance?.parseValid) reasons.push("OUTPUT_PARSE_INVALID");
  if (!acceptance?.structureValid) reasons.push("OUTPUT_STRUCTURE_INVALID");
  if (
    acceptance?.reviewRequired ||
    acceptance?.reasons?.includes("POSTPROCESS_REVIEW_REQUIRED")
  ) {
    reasons.push("POSTPROCESS_REVIEW_REQUIRED");
  }
  if (
    !Number.isFinite(acceptance?.confidence) ||
    acceptance.confidence < confidenceThreshold
  ) {
    reasons.push("CONFIDENCE_BELOW_THRESHOLD");
  }
  if (acceptance?.recommendedAction !== "autoAccept") {
    reasons.push("CORE_AUTO_ACCEPT_NOT_RECOMMENDED");
  }
  if (!FORMULA_INSERT_HOSTS.has(host)) {
    reasons.push("TARGET_HOST_INSERT_UNSUPPORTED");
  }

  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
    confidenceThreshold,
    qualityStatus: acceptance?.qualityStatus || "unknown",
    targetHost: host || "unknown",
  });
}
