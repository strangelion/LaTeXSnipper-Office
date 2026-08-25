const CONTENT_KINDS = new Set(["drawing", "customSymbol"]);

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function validateEditableMediaState(contentKind, editorState) {
  if (!CONTENT_KINDS.has(contentKind)) {
    throw new Error(`EDITABLE_MEDIA_KIND_UNSUPPORTED: ${contentKind}`);
  }
  if (
    !editorState ||
    editorState.schemaVersion !== 1 ||
    editorState.kind !== contentKind
  ) {
    throw new Error("EDITABLE_MEDIA_STATE_INVALID");
  }
  if (
    contentKind === "drawing" &&
    (typeof editorState.language !== "string" ||
      typeof editorState.source !== "string")
  ) {
    throw new Error("EDITABLE_MEDIA_DRAWING_SOURCE_MISSING");
  }
  if (
    contentKind === "customSymbol" &&
    !editorState.bundle?.symbol?.composition
  ) {
    throw new Error("EDITABLE_MEDIA_SYMBOL_COMPOSITION_MISSING");
  }
  return editorState;
}

export function buildEditableMediaInsertArgs({
  session,
  formulaId,
  contentKind,
  editorState,
  sourceLabel,
  svg,
  png,
  widthPt,
  heightPt,
  editable = false,
  actualRoute,
}) {
  validateEditableMediaState(contentKind, editorState);
  if (!session?.session_id) throw new Error("OFFICE_SESSION_REQUIRED");
  if (typeof svg !== "string" || !svg.includes("<svg")) {
    throw new Error("EDITABLE_MEDIA_SVG_REQUIRED");
  }
  if (editable && !png) throw new Error("EDITABLE_MEDIA_OLE_PNG_REQUIRED");
  return {
    sessionId: session.session_id,
    expectedDocumentId: session.document_id || null,
    formulaId,
    latex: String(sourceLabel || contentKind),
    omml: "",
    display: "block",
    mode: "display",
    svg,
    png: png || null,
    widthPt: positive(widthPt, 72),
    heightPt: positive(heightPt, 72),
    integrationMode: editable ? "ole" : "image",
    requestedRoute: contentKind,
    actualRoute:
      actualRoute || (editable ? `${contentKind}Ole` : `${contentKind}Image`),
    contentKind,
    editorState,
  };
}

export function mergeEditableMediaOlePayload({
  previous,
  formulaId,
  contentKind,
  editorState,
  sourceLabel,
  svg,
  png,
  widthPt,
  heightPt,
  revision,
}) {
  validateEditableMediaState(contentKind, editorState);
  if (typeof svg !== "string" || !svg.includes("<svg")) {
    throw new Error("EDITABLE_MEDIA_SVG_REQUIRED");
  }
  if (!png) throw new Error("EDITABLE_MEDIA_OLE_PNG_REQUIRED");
  return {
    ...(previous || {}),
    schemaVersion: Math.max(3, Number(previous?.schemaVersion) || 0),
    formulaId,
    latex: String(sourceLabel || contentKind),
    omml: "",
    display: "block",
    storageMode: "ole",
    contentKind,
    editorState,
    revision,
    render: {
      svg,
      png,
      widthPt: positive(widthPt, 72),
      heightPt: positive(heightPt, 72),
    },
  };
}

export function drawingEditorState(result) {
  const source = result?.originalSource ?? result?.payload?.source;
  const language =
    result?.originalLanguage ?? result?.payload?.sourceLanguage ?? "svg_source";
  return validateEditableMediaState("drawing", {
    schemaVersion: 1,
    kind: "drawing",
    language,
    packageProfiles: [...(result?.originalPackageProfiles || [])],
    source: String(source || ""),
  });
}

export function customSymbolEditorState(result) {
  return validateEditableMediaState("customSymbol", {
    schemaVersion: 1,
    kind: "customSymbol",
    bundle: structuredClone(result?.bundle),
  });
}
