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
  if (acceptance?.recommendedAction !== "autoAccept") {
    reasons.push("CORE_AUTO_ACCEPT_NOT_RECOMMENDED");
  }
  if (!FORMULA_INSERT_HOSTS.has(host)) {
    reasons.push("TARGET_HOST_INSERT_UNSUPPORTED");
  }

  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
    coreReasons: Object.freeze([...(acceptance?.reasons || [])]),
    qualityStatus: acceptance?.qualityStatus || "unknown",
    targetHost: host || "unknown",
  });
}
