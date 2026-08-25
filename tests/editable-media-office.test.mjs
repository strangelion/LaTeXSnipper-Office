import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectProductionDrawingRoute } from "../src/features/drawing/workspace.js";
import {
  buildEditableMediaInsertArgs,
  customSymbolEditorState,
  drawingEditorState,
  mergeEditableMediaOlePayload,
  validateEditableMediaState,
} from "../src/services/editable-media-office.js";

const drawingPayload = JSON.parse(
  readFileSync(
    new URL(
      "../src-tauri/latexsnipper-core/contracts/fixtures/drawing-office-payload-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("production drawing route enables editable OLE only when runtime support exists", () => {
  assert.equal(
    selectProductionDrawingRoute({
      payload: drawingPayload,
      host: "word",
      os: "windows",
      drawingOleAvailable: true,
    }).route,
    "drawingOle",
  );
  assert.equal(
    selectProductionDrawingRoute({
      payload: drawingPayload,
      host: "word",
      os: "windows",
      drawingOleAvailable: false,
    }).route,
    "svg",
  );
});

test("drawing editor state keeps original source instead of rendered SVG", () => {
  const state = drawingEditorState({
    payload: { source: "<svg/>", sourceLanguage: "svg_source" },
    originalLanguage: "mermaid",
    originalPackageProfiles: ["mermaid"],
    originalSource: "flowchart LR\n A-->B",
  });
  assert.deepEqual(state, {
    schemaVersion: 1,
    kind: "drawing",
    language: "mermaid",
    packageProfiles: ["mermaid"],
    source: "flowchart LR\n A-->B",
  });
});

test("custom symbol editor state retains the full Core composition bundle", () => {
  const bundle = {
    symbol: {
      id: "symbol-1",
      composition: { schemaVersion: 1, layers: [{ layerId: "layer-1" }] },
    },
  };
  const state = customSymbolEditorState({ bundle });
  bundle.symbol.composition.layers[0].layerId = "mutated";
  assert.equal(state.bundle.symbol.composition.layers[0].layerId, "layer-1");
});

test("editable custom symbol insertion uses a complete media payload, not a fake DrawingOfficePayload", () => {
  const editorState = {
    schemaVersion: 1,
    kind: "customSymbol",
    bundle: {
      symbol: { composition: { schemaVersion: 1, layers: [] } },
    },
  };
  const args = buildEditableMediaInsertArgs({
    session: { session_id: "word-1", document_id: "doc-1" },
    formulaId: "11111111-1111-4111-8111-111111111111",
    contentKind: "customSymbol",
    editorState,
    sourceLabel: "\\mySymbol",
    svg: '<svg viewBox="0 0 10 10"></svg>',
    png: "iVBORw0KGgo=",
    widthPt: 36,
    heightPt: 24,
    editable: true,
  });
  assert.equal(args.integrationMode, "ole");
  assert.equal(args.contentKind, "customSymbol");
  assert.equal(args.editorState, editorState);
  assert.equal("payload" in args, false);
});

test("editable media save increments revision while preserving Office context", () => {
  const editorState = {
    schemaVersion: 1,
    kind: "drawing",
    language: "svg_source",
    packageProfiles: [],
    source: '<svg viewBox="0 0 10 10"></svg>',
  };
  const payload = mergeEditableMediaOlePayload({
    previous: { host: "excel", documentContext: "book-1", revision: 4 },
    formulaId: "drawing-1",
    contentKind: "drawing",
    editorState,
    sourceLabel: editorState.source,
    svg: editorState.source,
    png: "iVBORw0KGgo=",
    widthPt: 72,
    heightPt: 40,
    revision: 5,
  });
  assert.equal(payload.host, "excel");
  assert.equal(payload.documentContext, "book-1");
  assert.equal(payload.revision, 5);
  assert.equal(payload.storageMode, "ole");
});

test("editable media rejects mismatched kinds before Office mutation", () => {
  assert.throws(
    () =>
      validateEditableMediaState("drawing", {
        schemaVersion: 1,
        kind: "customSymbol",
      }),
    /EDITABLE_MEDIA_STATE_INVALID/,
  );
});
