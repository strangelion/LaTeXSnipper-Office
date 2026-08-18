import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildCustomSymbolRequest,
  buildSmoothFreehandPath,
  coalescedPointerSamples,
  compositionSvg,
  createCompositionPayload,
  pointerInsideViewport,
  projectComposerPoint,
  resolveComposerViewportBounds,
  rotationFromPointer,
} from "../src/features/custom-symbols/composer.js";
import contractFixture from "./fixtures/custom-symbol-build-request-v1.json" with { type: "json" };

test("freehand strokes use a smooth midpoint path", () => {
  const path = buildSmoothFreehandPath([
    { x: 0, y: 0 },
    { x: 20, y: 10 },
    { x: 40, y: 0 },
    { x: 60, y: 20 },
  ]);
  assert.equal(
    path,
    "M0.0,0.0 Q20.0,10.0 30.0,5.0 Q40.0,0.0 50.0,10.0 T60.0,20.0",
  );
});

test("composer pointer coordinates use the actual SVG surface", () => {
  const bounds = { left: 250, top: 100, width: 500, height: 500 };
  assert.deepEqual(projectComposerPoint(250, 100, bounds), { x: 0, y: 0 });
  assert.deepEqual(projectComposerPoint(750, 600, bounds), {
    x: 1000,
    y: 1000,
  });
  assert.equal(projectComposerPoint(500, 350, bounds).x, 500);
});

test("composer pointer coordinates stop at the SVG edge", () => {
  const bounds = { left: 200, top: 100, width: 400, height: 400 };
  assert.deepEqual(projectComposerPoint(0, 300, bounds), { x: 0, y: 500 });
  assert.deepEqual(projectComposerPoint(900, 800, bounds), {
    x: 1000,
    y: 1000,
  });
});

test("composer pointer coordinates exclude SVG letterbox padding", () => {
  assert.deepEqual(
    resolveComposerViewportBounds(
      { left: 465, top: 205, width: 650, height: 208 },
      { width: 1000, height: 1000 },
    ),
    { left: 686, top: 205, width: 208, height: 208 },
  );
  const point = projectComposerPoint(790, 309, {
    left: 686,
    top: 205,
    width: 208,
    height: 208,
  });
  assert.deepEqual(point, { x: 500, y: 500 });
});

test("freehand keeps pointer moves when coalesced samples are empty", () => {
  const event = { clientX: 42, getCoalescedEvents: () => [] };
  assert.deepEqual(coalescedPointerSamples(event), [event]);
  const samples = [{ clientX: 10 }, { clientX: 20 }];
  assert.equal(
    coalescedPointerSamples({ getCoalescedEvents: () => samples }),
    samples,
  );
});

const layer = {
  layerId: "line-1",
  name: "line",
  source: {
    kind: "primitive",
    primitive: {
      kind: "line",
      from: { x: -100, y: 0 },
      to: { x: 100, y: 0 },
      strokeWidth: 12,
    },
  },
  transform: {
    translateX: 500,
    translateY: 500,
    scaleX: 1,
    scaleY: 1,
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
  },
  opacity: 1,
  color: "#7C3AED",
  zIndex: 0,
  visible: true,
};

test("visual composer emits inert SVG and the frozen Core composition shape", () => {
  const svg = compositionSvg([layer], layer.layerId);
  assert.match(svg, /viewBox="0 0 1000 1000"/);
  assert.match(svg, /data-layer-id="line-1"/);
  assert.match(svg, /color="#7C3AED"/);
  assert.match(svg, /data-symbol-handle="scale"/);
  assert.match(svg, /data-symbol-handle="scale-x"/);
  assert.match(svg, /data-symbol-handle="scale-y"/);
  assert.match(svg, /data-symbol-handle="rotate"/);
  assert.match(svg, /class="symbol-editor-overlay"/);
  assert.doesNotMatch(
    svg,
    /opacity="0\.35"[^>]*>[^<]*<g class="symbol-transform-box"/,
  );
  assert.doesNotMatch(svg, /script|foreignObject|href=/i);

  const composition = createCompositionPayload([layer], true);
  assert.equal(composition.schemaVersion, 1);
  assert.equal(composition.gridSize, 25);
  assert.equal(composition.layers[0].source.primitive.kind, "line");
  assert.equal(composition.layers[0].color, "#7C3AED");
  assert.doesNotMatch(
    JSON.stringify(composition),
    /symbol-transform-box|symbol-selection-frame|show-grid/,
  );
});

test("rotation is continuous unless Shift requests 15 degree snapping", () => {
  assert.equal(rotationFromPointer(0, 0, Math.PI / 7, false), 25.7);
  assert.equal(rotationFromPointer(0, 0, Math.PI / 7, true), 30);
  assert.equal(rotationFromPointer(10, Math.PI - 0.1, -Math.PI + 0.1), 21.5);
});

test("transform drags ignore WebView edge sentinel coordinates", () => {
  assert.equal(pointerInsideViewport(640, 360, 1280, 720), true);
  assert.equal(pointerInsideViewport(0, 360, 1280, 720), false);
  assert.equal(pointerInsideViewport(640, 720, 1280, 720), false);
  assert.equal(pointerInsideViewport(Number.NaN, 20, 1280, 720), false);
});

test("composition payload is detached from mutable editor state", () => {
  const composition = createCompositionPayload([layer], false);
  layer.transform.translateX = 725;
  assert.equal(composition.layers[0].transform.translateX, 500);
  assert.equal(composition.snapToGrid, false);
});

test("LaTeX layers preserve source but keep rendered markup outside the Core contract", () => {
  const formula = {
    ...layer,
    layerId: "formula-1",
    source: {
      kind: "formula",
      latex: "\\overset{\\star}{\\longrightarrow}",
      metricsSnapshot: {
        unitsPerEm: 1000,
        advanceWidth: 500,
        boundingBox: { minX: -250, minY: -100, maxX: 250, maxY: 100 },
      },
      renderedSvg: '<svg viewBox="0 0 10 10"><path d="M0 5L10 5"/></svg>',
    },
  };
  const svg = compositionSvg([formula]);
  assert.match(svg, /M0 5L10 5/);
  const composition = createCompositionPayload([formula]);
  assert.equal(composition.layers[0].source.latex, formula.source.latex);
  assert.equal("renderedSvg" in composition.layers[0].source, false);
});

test("frontend custom-symbol request stays byte-shape compatible with the Rust DTO fixture", () => {
  const contractLayer = structuredClone(layer);
  contractLayer.transform.translateX = 500;
  const request = buildCustomSymbolRequest({
    id: "user-contract-symbol",
    name: "Contract symbol",
    latexCommand: "\\contractsymbol",
    mathClass: "ordinary",
    layers: [contractLayer],
    snapToGrid: true,
  });
  assert.deepEqual(request, contractFixture);
});
