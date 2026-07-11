import assert from "node:assert/strict";
import test from "node:test";

import { FormulaSvgRenderer } from "../src/services/formula-svg-renderer.js";

function svg(attributes) {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function assertAspectRatio(size, expected, message) {
  assert.ok(Math.abs(size.widthPt / size.heightPt - expected) < 1e-9, message);
}

test("keeps explicit point dimensions when they are within constraints", () => {
  const size = new FormulaSvgRenderer()._computeSvgSize(
    svg({
      width: "120pt",
      height: "30pt",
      viewBox: "0 0 1200 300",
    }),
  );

  assert.equal(size.widthPt, 120);
  assert.equal(size.heightPt, 30);
  assertAspectRatio(
    size,
    4,
    "explicit dimensions must keep their aspect ratio",
  );
});

test("uses the viewBox when MathJax dimensions are absent", () => {
  const size = new FormulaSvgRenderer()._computeSvgSize(
    svg({ viewBox: "0 0 900 300" }),
  );

  assert.equal(size.widthPt, 90);
  assert.equal(size.heightPt, 30);
  assertAspectRatio(size, 3, "viewBox dimensions must keep their aspect ratio");
});

test("derives a missing dimension from the viewBox", () => {
  const renderer = new FormulaSvgRenderer();
  const fromHeight = renderer._computeSvgSize(
    svg({ height: "24pt", viewBox: "0 0 400 100" }),
  );
  const fromWidth = renderer._computeSvgSize(
    svg({ width: "60pt", viewBox: "0 0 100 400" }),
  );

  assert.equal(fromHeight.widthPt, 96);
  assert.equal(fromHeight.heightPt, 24);
  assertAspectRatio(
    fromHeight,
    4,
    "height-derived width must keep the viewBox ratio",
  );
  assert.equal(fromWidth.widthPt, 60);
  assert.equal(fromWidth.heightPt, 240);
  assertAspectRatio(
    fromWidth,
    0.25,
    "width-derived height must keep the viewBox ratio",
  );
});

test("uniformly constrains very wide and very tall formulas", () => {
  const renderer = new FormulaSvgRenderer();
  const wide = renderer._computeSvgSize(
    svg({ width: "2000pt", height: "100pt" }),
  );
  const tall = renderer._computeSvgSize(
    svg({ width: "100pt", height: "1000pt" }),
  );

  assert.equal(wide.widthPt, 480);
  assert.equal(wide.heightPt, 24);
  assertAspectRatio(wide, 20, "wide formula must not be stretched");
  assert.equal(tall.widthPt, 24);
  assert.equal(tall.heightPt, 240);
  assertAspectRatio(tall, 0.1, "tall formula must not be stretched");
});

test("uniformly raises formulas below the minimum size", () => {
  const size = new FormulaSvgRenderer()._computeSvgSize(
    svg({ width: "3pt", height: "2pt" }),
  );

  assert.equal(size.widthPt, 18);
  assert.equal(size.heightPt, 12);
  assertAspectRatio(
    size,
    1.5,
    "minimum-size scaling must preserve the aspect ratio",
  );
});
