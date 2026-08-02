export const DRAWING_INSERT_ROUTES = Object.freeze([
  "nativeShapes",
  "drawingOle",
  "svg",
  "png",
  "pdf",
]);

const SHA256 = /^[0-9a-f]{64}$/i;
const ARTIFACT_FORMATS = new Set(["svg", "png", "pdf", "web_p", "eps"]);

export function drawingArtifacts(payload) {
  return [
    payload?.preferredArtifact,
    ...(payload?.fallbackArtifacts || []),
  ].filter(Boolean);
}

export function findDrawingArtifact(payload, format) {
  return (
    drawingArtifacts(payload).find((artifact) => artifact.format === format) ||
    null
  );
}

function validArtifact(artifact) {
  return (
    artifact &&
    ARTIFACT_FORMATS.has(artifact.format) &&
    typeof artifact.contentRef === "string" &&
    artifact.contentRef.length > 0 &&
    SHA256.test(artifact.sha256 || "") &&
    (artifact.sanitizerReportSha256 == null ||
      SHA256.test(artifact.sanitizerReportSha256))
  );
}

export function validateDrawingPayload(payload) {
  const required = [
    "schemaVersion",
    "drawingId",
    "sourceLanguage",
    "source",
    "compatibility",
    "preferredArtifact",
    "widthPoints",
    "heightPoints",
    "sourceSha256",
    "renderSha256",
    "compilerFingerprint",
    "resourcesSha256",
  ];
  const missing = required.filter((field) => payload?.[field] == null);
  const invalid = [];
  if (!Number.isInteger(payload?.schemaVersion) || payload.schemaVersion < 1) {
    invalid.push("schemaVersion");
  }
  for (const field of ["sourceSha256", "renderSha256", "resourcesSha256"]) {
    if (!SHA256.test(payload?.[field] || "")) invalid.push(field);
  }
  if (!validArtifact(payload?.preferredArtifact))
    invalid.push("preferredArtifact");
  if (!(payload?.fallbackArtifacts || []).every(validArtifact)) {
    invalid.push("fallbackArtifacts");
  }
  if (!(Number(payload?.widthPoints) > 0)) invalid.push("widthPoints");
  if (!(Number(payload?.heightPoints) > 0)) invalid.push("heightPoints");
  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    forwardCompatible: Number(payload?.schemaVersion) >= 1,
  };
}

export function selectDrawingOfficeRoute({
  payload,
  host,
  os,
  requestEditable = false,
  requestPrint = false,
  capabilities = {},
}) {
  const validation = validateDrawingPayload(payload);
  if (!validation.valid) {
    return { route: null, code: "DRAWING_OFFICE_PAYLOAD_INVALID", validation };
  }
  if (
    requestPrint &&
    capabilities.pdfExport === true &&
    findDrawingArtifact(payload, "pdf")
  ) {
    return { route: "pdf", code: "DRAWING_ROUTE_PRINT", validation };
  }
  if (
    requestEditable &&
    payload.officeShapeScene != null &&
    capabilities.nativeShapes === true
  ) {
    return { route: "nativeShapes", code: "DRAWING_ROUTE_NATIVE", validation };
  }
  if (
    requestEditable &&
    os === "windows" &&
    capabilities.drawingOle === true &&
    (findDrawingArtifact(payload, "svg") || findDrawingArtifact(payload, "png"))
  ) {
    return { route: "drawingOle", code: "DRAWING_ROUTE_OLE", validation };
  }
  if (capabilities.svg !== false && findDrawingArtifact(payload, "svg")) {
    return { route: "svg", code: "DRAWING_ROUTE_SVG", validation };
  }
  if (capabilities.png !== false && findDrawingArtifact(payload, "png")) {
    return { route: "png", code: "DRAWING_ROUTE_PNG_FALLBACK", validation };
  }
  return {
    route: null,
    code: "DRAWING_OFFICE_ROUTE_UNAVAILABLE",
    host,
    validation,
  };
}

export function drawingAdapterReadiness(coreReadiness) {
  return (coreReadiness?.adapters || []).map((adapter) => ({
    language: adapter.language,
    level: adapter.level,
    capabilities: { ...(adapter.capabilities || {}) },
    experimental: adapter.experimental === true,
    blocked: adapter.blocked === true,
    requiresSetup: adapter.requiresSetup === true,
    diagnostic: adapter.diagnostic ?? null,
  }));
}
