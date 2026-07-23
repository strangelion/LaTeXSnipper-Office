// Office insertion service — unified API for inserting artifacts into Office.
//
// This replaces ad-hoc insertion logic in Editor, OCR, History, and AI modules.
// All insertion paths go through this service.

/**
 * @typedef {'formula' | 'table' | 'document'} ArtifactType
 * @typedef {'Word' | 'Excel' | 'PowerPoint' | 'Visio'} OfficeHost
 */

/**
 * Insert an artifact into the active Office host.
 *
 * @param {{
 *   type: ArtifactType,
 *   payload: object,
 *   targetHost: string,
 *   options?: object,
 * }} params
 * @returns {Promise<object>}
 */
export async function insertArtifact({
  type,
  payload,
  targetHost,
  options = {},
}) {
  switch (type) {
    case "formula":
      return insertFormula(payload, targetHost, options);
    case "table":
      return insertTable(payload, targetHost, options);
    case "document":
      return insertDocument(payload, targetHost, options);
    default:
      throw new Error(`Unsupported artifact type: ${type}`);
  }
}

/**
 * Insert a formula into Office.
 *
 * @param {object} payload — { format: string, content: string }
 * @param {string} targetHost — "word", "excel", "powerpoint", "visio"
 * @param {object} options — { display?: string, storageMode?: string }
 */
async function insertFormula(payload, targetHost, options) {
  const { invoke } = await import("@tauri-apps/api/core");

  // Route through Coordinator — single entry point for all insertions
  const route = await invoke("office_resolve_route", {
    host: targetHost,
    preferredSessionId: options.sessionId ?? null,
    expectedDocumentId: options.documentContext ?? null,
  });

  return invoke("native_office_insert_formula", {
    sessionId: route.target.sessionId,
    expectedDocumentId: route.target.documentContext ?? null,
    formulaId: `formula-${Date.now().toString(16)}`,
    latex: payload.content,
    omml: payload.format === "omml" ? payload.content : "",
    display: options.display || "inline",
    mode: options.display || "inline",
    svg: options.svg ?? null,
    png: options.png ?? null,
    widthPt: options.widthPt ?? null,
    heightPt: options.heightPt ?? null,
    integrationMode: options.storageMode || "auto",
    requestedRoute: options.routeMode || "auto",
    actualRoute: route.actualRoute,
  });
}

/**
 * Insert a table into Office.
 */
async function insertTable(payload, targetHost, options = {}) {
  const { invoke } = await import("@tauri-apps/api/core");

  const route = await invoke("office_resolve_route", {
    host: targetHost,
    preferredSessionId: options.sessionId ?? null,
    expectedDocumentId: options.documentContext ?? null,
  });

  return invoke("native_office_insert_table", {
    sessionId: route.target.sessionId,
    expectedDocumentId: route.target.documentContext ?? null,
    tableJson: JSON.stringify(payload),
  });
}

/**
 * Insert a full document into Office.
 */
async function insertDocument(payload, targetHost, options = {}) {
  const { invoke } = await import("@tauri-apps/api/core");
  const route = await invoke("office_resolve_route", {
    host: targetHost,
    preferredSessionId: options.sessionId ?? null,
    expectedDocumentId: options.documentContext ?? null,
  });
  return invoke("office_insert_artifact", {
    artifact: {
      artifactType: "document",
      payload,
      target: route.target,
      options: {},
    },
  });
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

/**
 * Scan and batch-convert LaTeX in an Office document.
 */
export async function batchConvertLatex(target, scope = "entireDocument") {
  const api = await import("../features/recognition/api.js");

  // Step 1: Scan
  const candidates = await api.batchScanLatex(target, scope);

  if (!candidates || candidates.length === 0) {
    return { total: 0, converted: 0, skipped: 0, failed: 0, failures: [] };
  }

  // Step 2: Build conversion plan (target stored in plan for execution)
  const plan = await api.batchConvertPlan(target, candidates);

  // Step 3: Execute (plan carries its own target)
  const result = await api.batchExecute(plan);

  return result;
}
