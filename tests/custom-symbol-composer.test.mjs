import { strict as assert } from "node:assert";
import test from "node:test";
import {
  compositionSvg,
  createCompositionPayload,
} from "../src/features/custom-symbols/composer.js";

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
