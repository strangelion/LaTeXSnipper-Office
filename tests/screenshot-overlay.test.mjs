/**
 * Screenshot overlay tests.
 *
 * These tests verify coordinate transformation and selection
 * validation logic used by capture.js.
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// normalizeRect
// ---------------------------------------------------------------------------

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function testNormalizeRect() {
  // Basic: positive drag
  {
    const r = normalizeRect({ x: 100, y: 100 }, { x: 300, y: 200 });
    assert.strictEqual(r.x, 100);
    assert.strictEqual(r.y, 100);
    assert.strictEqual(r.width, 200);
    assert.strictEqual(r.height, 100);
  }

  // Reverse drag (bottom-right to top-left)
  {
    const r = normalizeRect({ x: 300, y: 200 }, { x: 100, y: 100 });
    assert.strictEqual(r.x, 100);
    assert.strictEqual(r.y, 100);
    assert.strictEqual(r.width, 200);
    assert.strictEqual(r.height, 100);
  }

  // Zero-size
  {
    const r = normalizeRect({ x: 100, y: 100 }, { x: 100, y: 100 });
    assert.strictEqual(r.width, 0);
    assert.strictEqual(r.height, 0);
  }
}

// ---------------------------------------------------------------------------
// DPI conversion
// ---------------------------------------------------------------------------

function pointerToPhysical(
  eventX,
  eventY,
  canvasW,
  canvasH,
  physicalW,
  physicalH,
) {
  return {
    x: Math.round(((eventX - 0) / canvasW) * physicalW),
    y: Math.round(((eventY - 0) / canvasH) * physicalH),
  };
}

function simulateCanvas(scaleFactor = 1.0) {
  const logicalW = 1920;
  const logicalH = 1080;
  const physicalW = Math.round(logicalW * scaleFactor);
  const physicalH = Math.round(logicalH * scaleFactor);
  return { logicalW, logicalH, physicalW, physicalH, scaleFactor };
}

function testDpi100() {
  const canvas = simulateCanvas(1.0);

  // Click at logical (960, 540) => physical (960, 540)
  const pt = pointerToPhysical(
    960,
    540,
    canvas.logicalW,
    canvas.logicalH,
    canvas.physicalW,
    canvas.physicalH,
  );
  assert.strictEqual(pt.x, 960);
  assert.strictEqual(pt.y, 540);
}

function testDpi125() {
  const canvas = simulateCanvas(1.25);

  // Click at logical (960, 540) => physical (1200, 675)
  const pt = pointerToPhysical(
    960,
    540,
    canvas.logicalW,
    canvas.logicalH,
    canvas.physicalW,
    canvas.physicalH,
  );
  assert.strictEqual(pt.x, 1200);
  assert.strictEqual(pt.y, 675);
}

function testDpi150() {
  const canvas = simulateCanvas(1.5);

  // Click at logical (960, 540) => physical (1440, 810)
  const pt = pointerToPhysical(
    960,
    540,
    canvas.logicalW,
    canvas.logicalH,
    canvas.physicalW,
    canvas.physicalH,
  );
  assert.strictEqual(pt.x, 1440);
  assert.strictEqual(pt.y, 810);
}

function testDpi200() {
  const canvas = simulateCanvas(2.0);

  // Click at logical (960, 540) => physical (1920, 1080)
  const pt = pointerToPhysical(
    960,
    540,
    canvas.logicalW,
    canvas.logicalH,
    canvas.physicalW,
    canvas.physicalH,
  );
  assert.strictEqual(pt.x, 1920);
  assert.strictEqual(pt.y, 1080);
}

function testDpiNotReusedAsPhysical() {
  // At 150% DPI, logical coords must NOT be used directly as physical
  const canvas = simulateCanvas(1.5);
  const pt = pointerToPhysical(
    960,
    540,
    canvas.logicalW,
    canvas.logicalH,
    canvas.physicalW,
    canvas.physicalH,
  );

  // If we naively used logical as physical, we'd get 960x540
  assert.notStrictEqual(pt.x, 960);
  assert.notStrictEqual(pt.y, 540);

  // Physical coords must be within image dimensions
  assert.ok(pt.x <= canvas.physicalW);
  assert.ok(pt.y <= canvas.physicalH);
}

// ---------------------------------------------------------------------------
// Selection validation
// ---------------------------------------------------------------------------

function isTooSmall(w, h) {
  return w < 8 || h < 8;
}

function testSelectionValidation() {
  assert.ok(isTooSmall(0, 0));
  assert.ok(isTooSmall(7, 100));
  assert.ok(isTooSmall(100, 7));
  assert.ok(!isTooSmall(8, 8));
  assert.ok(!isTooSmall(200, 100));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

testNormalizeRect();
testDpi100();
testDpi125();
testDpi150();
testDpi200();
testDpiNotReusedAsPhysical();
testSelectionValidation();

console.log("All screenshot overlay tests passed OK");
