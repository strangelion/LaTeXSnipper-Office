import { strict as assert } from "node:assert";
import {
  drawingAdapterReadiness,
  selectDrawingOfficeRoute,
} from "../src/features/drawing/office-routing.js";

const payload = {
  schemaVersion: 1,
  drawingId: "drawing-1",
  sourceLanguage: "tikz",
  sourceSha256: "a".repeat(64),
  renderSha256: "b".repeat(64),
  compilerFingerprint: "tectonic:test",
  resourcesSha256: "c".repeat(64),
  officeShapeScene: { fullyCompatible: false },
  artifacts: { svg: "svg-1", png: "png-1", emfPreview: "emf-1" },
};

assert.equal(
  selectDrawingOfficeRoute({
    payload,
    host: "powerpoint",
    os: "windows",
    requestEditable: true,
    capabilities: { nativeShapes: true, drawingOle: false, svg: true },
  }).route,
  "svg",
);
assert.equal(
  selectDrawingOfficeRoute({
    payload: { ...payload, artifacts: { png: "png-1" } },
    host: "excel",
    os: "macos",
    capabilities: { svg: false },
  }).route,
  "png",
);
assert.equal(
  drawingAdapterReadiness({
    adapters: [{ id: "plantuml", compilerDetected: false }],
  })[0].level,
  "requiresSetup",
);

console.log("Drawing Office route and readiness contracts passed OK");
