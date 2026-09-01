import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildDrawingConversionRequest,
  drawingAdapterReadiness,
  findDrawingArtifact,
  planDrawingOfficeRoute,
  selectDrawingOfficeRoute,
  validateDrawingPayload,
} from "../src/features/drawing/office-routing.js";

const coreFixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../src-tauri/latexsnipper-core/contracts/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("Office consumes the Core-owned DrawingOfficePayload fixture", () => {
  const payload = coreFixture("drawing-office-payload-v1.json");
  assert.deepEqual(validateDrawingPayload(payload), {
    valid: true,
    missing: [],
    invalid: [],
    forwardCompatible: true,
  });
  assert.equal(findDrawingArtifact(payload, "svg"), payload.preferredArtifact);
  assert.equal(
    findDrawingArtifact(payload, "png"),
    payload.fallbackArtifacts[0],
  );
  assert.equal(
    selectDrawingOfficeRoute({
      payload,
      host: "powerpoint",
      os: "windows",
      requestEditable: true,
      capabilities: { nativeShapes: true, drawingOle: false, svg: true },
    }).route,
    "nativeShapes",
  );
  assert.equal(
    selectDrawingOfficeRoute({
      payload: { ...payload, officeShapeScene: null },
      host: "powerpoint",
      os: "windows",
      requestEditable: true,
      capabilities: { nativeShapes: true, drawingOle: false, svg: true },
    }).route,
    "svg",
  );
  assert.equal(
    selectDrawingOfficeRoute({
      payload: {
        ...payload,
        officeShapeScene: null,
        preferredArtifact: payload.fallbackArtifacts[0],
        fallbackArtifacts: [],
      },
      host: "excel",
      os: "macos",
      capabilities: { svg: false, png: true },
    }).route,
    "png",
  );
});

test("Office consumes exact Core DrawingReadiness fields", () => {
  const readiness = coreFixture("drawing-readiness-v1.json");
  const adapters = drawingAdapterReadiness(readiness);
  assert.equal(adapters.length, readiness.adapters.length);
  assert.deepEqual(adapters[0], readiness.adapters[0]);
  const svg = adapters.find((adapter) => adapter.language === "svg_source");
  assert.equal(svg.level, "compilerDetected");
  assert.equal(svg.requiresSetup, false);
  assert.equal(svg.capabilities.svgOutput, true);
});

test("old handwritten payload shape fails closed", () => {
  const oldPayload = {
    schemaVersion: 1,
    drawingId: "legacy",
    sourceLanguage: "tikz",
    source: "x",
    artifacts: { svg: "legacy.svg" },
  };
  const result = selectDrawingOfficeRoute({ payload: oldPayload });
  assert.equal(result.route, null);
  assert.equal(result.code, "DRAWING_OFFICE_PAYLOAD_INVALID");
});

test("drawing host facts are translated into Core planner input", () => {
  const payload = coreFixture("drawing-office-payload-v1.json");
  const { request, validation } = buildDrawingConversionRequest({
    payload,
    host: "powerPoint",
    os: "windows",
    requestEditable: true,
    capabilities: {
      nativeShapes: true,
      drawingOle: true,
      svg: true,
      png: true,
    },
  });
  assert.equal(validation.valid, true);
  assert.equal(request.artifact, "drawing");
  assert.equal(request.requirements.preferNative, true);
  assert.equal(request.requirements.minimumEditability, 1);
  assert.equal(
    request.capabilities.find(({ route }) => route === "nativeShapes")
      .available,
    true,
  );
  assert.equal(
    request.capabilities.find(({ route }) => route === "drawingOle").available,
    true,
  );
});

test("production drawing route consumes Core plan and exposes its loss ledger", async () => {
  const payload = coreFixture("drawing-office-payload-v1.json");
  let captured;
  const result = await planDrawingOfficeRoute(
    {
      payload,
      host: "excel",
      os: "windows",
      requestEditable: true,
      capabilities: { drawingOle: true, svg: true, png: true },
    },
    async (request) => {
      captured = request;
      return {
        schemaVersion: 1,
        status: "planned",
        selected: {
          route: "drawingOle",
          losses: [{ code: "visual-degradation", severity: "low" }],
        },
        fallbacks: [],
        rejected: [],
      };
    },
  );
  assert.equal(captured.host, "excel");
  assert.equal(result.route, "drawingOle");
  assert.equal(result.code, "DRAWING_ROUTE_PLANNED");
  assert.deepEqual(result.lossLedger, [
    { code: "visual-degradation", severity: "low" },
  ]);
});
