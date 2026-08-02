export const DRAWING_INSERT_ROUTES = Object.freeze([
  "nativeShapes",
  "drawingOle",
  "svg",
  "png",
  "pdf",
]);

export function validateDrawingPayload(payload) {
  const required = [
    "schemaVersion",
    "drawingId",
    "sourceLanguage",
    "sourceSha256",
    "renderSha256",
    "compilerFingerprint",
    "resourcesSha256",
  ];
  const missing = required.filter((field) => !payload?.[field]);
  return {
    valid: missing.length === 0,
    missing,
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
  if (requestPrint && payload.artifacts?.pdf) {
    return { route: "pdf", code: "DRAWING_ROUTE_PRINT", validation };
  }
  if (
    requestEditable &&
    payload.officeShapeScene?.fullyCompatible === true &&
    capabilities.nativeShapes === true
  ) {
    return { route: "nativeShapes", code: "DRAWING_ROUTE_NATIVE", validation };
  }
  if (
    requestEditable &&
    os === "windows" &&
    capabilities.drawingOle === true &&
    payload.artifacts?.emfPreview
  ) {
    return { route: "drawingOle", code: "DRAWING_ROUTE_OLE", validation };
  }
  if (capabilities.svg !== false && payload.artifacts?.svg) {
    return { route: "svg", code: "DRAWING_ROUTE_SVG", validation };
  }
  if (payload.artifacts?.png) {
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
    id: adapter.id,
    level: adapter.productionRecommended
      ? "available"
      : adapter.compilerDetected
        ? "experimental"
        : "requiresSetup",
    parserAvailable: adapter.parserAvailable === true,
    compilerDetected: adapter.compilerDetected === true,
    packageSetValidated: adapter.packageSetValidated === true,
    smokeCompilePassed: adapter.smokeCompilePassed === true,
    goldenRenderPassed: adapter.goldenRenderPassed === true,
  }));
}
