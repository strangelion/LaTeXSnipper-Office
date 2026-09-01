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

function capability(route, available, fidelity, evidence = []) {
  return { route, available, fidelity, evidence, losses: [] };
}

/**
 * Translate an observed drawing payload and host state into Core planner input.
 * This layer reports facts only; route scoring and loss accounting stay in Core.
 */
export function buildDrawingConversionRequest({
  payload,
  host,
  os,
  requestEditable = false,
  requestPrint = false,
  capabilities = {},
}) {
  const validation = validateDrawingPayload(payload);
  if (!validation.valid) return { request: null, validation };

  const hasSvg = Boolean(findDrawingArtifact(payload, "svg"));
  const hasPng = Boolean(findDrawingArtifact(payload, "png"));
  const hasPdf = Boolean(findDrawingArtifact(payload, "pdf"));
  const observed = [
    capability(
      "nativeShapes",
      requestEditable &&
        payload.officeShapeScene != null &&
        capabilities.nativeShapes === true,
      { semantic: 900, visual: 920, editability: 1000, roundTrip: 950 },
      ["officeShapeScene"],
    ),
    capability(
      "drawingOle",
      requestEditable &&
        os === "windows" &&
        capabilities.drawingOle === true &&
        (hasSvg || hasPng),
      { semantic: 980, visual: 990, editability: 960, roundTrip: 960 },
      ["windowsOle", hasSvg ? "svgArtifact" : "pngArtifact"],
    ),
    capability(
      "svg",
      capabilities.svg !== false && hasSvg,
      { semantic: 600, visual: 1000, editability: 250, roundTrip: 300 },
      ["svgArtifact"],
    ),
    capability(
      "png",
      capabilities.png !== false && hasPng,
      { semantic: 0, visual: 970, editability: 0, roundTrip: 0 },
      ["pngArtifact"],
    ),
    capability(
      "pdf",
      requestPrint && capabilities.pdfExport === true && hasPdf,
      { semantic: 450, visual: 990, editability: 100, roundTrip: 150 },
      ["pdfArtifact", "printRequested"],
    ),
  ];

  return {
    validation,
    request: {
      artifact: "drawing",
      host: String(host || "unknown"),
      platform: String(os || "unknown"),
      requirements: {
        minimumSemanticFidelity: null,
        minimumVisualFidelity: requestPrint ? 900 : null,
        minimumEditability: requestEditable ? 1 : null,
        minimumRoundTripFidelity: null,
        preferNative: requestEditable,
        preferVector: true,
        allowRaster: !requestPrint,
      },
      capabilities: observed,
    },
  };
}

/** Resolve a drawing route through the Core Conversion Planner. */
export async function planDrawingOfficeRoute(args, planner) {
  const { request, validation } = buildDrawingConversionRequest(args);
  if (!request) {
    return { route: null, code: "DRAWING_OFFICE_PAYLOAD_INVALID", validation };
  }
  const execute =
    planner ||
    (async (conversionRequest) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("core_plan_conversion", { request: conversionRequest });
    });
  const plan = await execute(request);
  const selected = plan?.selected || null;
  return {
    route: selected?.route || null,
    code: selected
      ? "DRAWING_ROUTE_PLANNED"
      : "DRAWING_OFFICE_ROUTE_UNAVAILABLE",
    validation,
    plan,
    lossLedger: selected?.losses || [],
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
