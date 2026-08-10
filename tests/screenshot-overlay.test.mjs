/**
 * Screenshot overlay tests.
 *
 * These tests verify coordinate transformation and selection
 * validation logic used by capture.js.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  normalizeRect,
  pointerToPreview,
  previewRectToPhysical,
} from "../src/features/screenshot/coordinates.js";

// ---------------------------------------------------------------------------
// normalizeRect
// ---------------------------------------------------------------------------

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
  const pt = previewRectToPhysical(
    { x: 960, y: 540, width: 0, height: 0 },
    { width: canvas.logicalW, height: canvas.logicalH },
    { width: canvas.physicalW, height: canvas.physicalH },
  );
  assert.strictEqual(pt.x, 960);
  assert.strictEqual(pt.y, 540);
}

function testDpi125() {
  const canvas = simulateCanvas(1.25);

  // Click at logical (960, 540) => physical (1200, 675)
  const pt = previewRectToPhysical(
    { x: 960, y: 540, width: 0, height: 0 },
    { width: canvas.logicalW, height: canvas.logicalH },
    { width: canvas.physicalW, height: canvas.physicalH },
  );
  assert.strictEqual(pt.x, 1200);
  assert.strictEqual(pt.y, 675);
}

function testDpi150() {
  const canvas = simulateCanvas(1.5);

  // Click at logical (960, 540) => physical (1440, 810)
  const pt = previewRectToPhysical(
    { x: 960, y: 540, width: 0, height: 0 },
    { width: canvas.logicalW, height: canvas.logicalH },
    { width: canvas.physicalW, height: canvas.physicalH },
  );
  assert.strictEqual(pt.x, 1440);
  assert.strictEqual(pt.y, 810);
}

function testDpi200() {
  const canvas = simulateCanvas(2.0);

  // Click at logical (960, 540) => physical (1920, 1080)
  const pt = previewRectToPhysical(
    { x: 960, y: 540, width: 0, height: 0 },
    { width: canvas.logicalW, height: canvas.logicalH },
    { width: canvas.physicalW, height: canvas.physicalH },
  );
  assert.strictEqual(pt.x, 1920);
  assert.strictEqual(pt.y, 1080);
}

function testDpiNotReusedAsPhysical() {
  // At 150% DPI, logical coords must NOT be used directly as physical
  const canvas = simulateCanvas(1.5);
  const pt = previewRectToPhysical(
    { x: 960, y: 540, width: 0, height: 0 },
    { width: canvas.logicalW, height: canvas.logicalH },
    { width: canvas.physicalW, height: canvas.physicalH },
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

function testPreviewPointerAndNegativeMonitorOrigin() {
  const point = pointerToPreview(
    500,
    350,
    { left: 100, top: 50, width: 800, height: 600 },
    { width: 1600, height: 1200 },
  );
  assert.deepEqual(point, { x: 800, y: 600 });

  const rect = previewRectToPhysical(
    { x: 128, y: 72, width: 512, height: 288 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
  );
  assert.deepEqual(rect, { x: 192, y: 108, width: 768, height: 432 });

  // Monitor origin is transported separately; local preview coordinates
  // remain non-negative even for a secondary display at negative X/Y.
  const physicalOrigin = { x: -2560, y: -240 };
  assert.deepEqual(
    { x: physicalOrigin.x + rect.x, y: physicalOrigin.y + rect.y },
    { x: -2368, y: -132 },
  );
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
testPreviewPointerAndNegativeMonitorOrigin();

const captureSource = readFileSync(
  new URL("../src/capture.js", import.meta.url),
  "utf8",
);
assert.match(captureSource, /screenshot_overlay_ready/);
assert.match(captureSource, /convertFileSrc\(init\.previewPath\)/);
assert.match(captureSource, /previewRectToPhysical/);
assert.doesNotMatch(captureSource, /previewDataUrl/);
assert.match(captureSource, /for \(let attempt = 0; attempt < 5;/);
assert.match(captureSource, /SESSION_NOT_READY/);
assert.ok(
  captureSource.indexOf("await new Promise") <
    captureSource.indexOf('"screenshot_overlay_ready"'),
  "overlay must wait for preview decode before sending ready",
);

const screenshotBackendSource = readFileSync(
  new URL("../src-tauri/src/screenshot/backend.rs", import.meta.url),
  "utf8",
);
const screenshotCommandsSource = readFileSync(
  new URL("../src-tauri/src/screenshot/commands.rs", import.meta.url),
  "utf8",
);
const screenshotStateSource = readFileSync(
  new URL("../src-tauri/src/screenshot/state.rs", import.meta.url),
  "utf8",
);
assert.match(screenshotCommandsSource, /overlay_ready_timeout/);
assert.match(screenshotCommandsSource, /ready=\{\}\/\{\} missing=\{\}/);
assert.match(screenshotStateSource, /pub fn ready_progress/);
assert.match(screenshotBackendSource, /XDG_SESSION_TYPE/);
assert.match(screenshotBackendSource, /WAYLAND_DISPLAY/);
assert.match(screenshotBackendSource, /DISPLAY/);
assert.match(screenshotBackendSource, /backend: "xcap-wayland"/);
assert.match(
  screenshotBackendSource,
  /Portal\/PipeWire adapter is not implemented/,
);
assert.match(
  screenshotBackendSource,
  /backend: "xcap-wayland",[\s\S]*?available: false/,
);

console.log("All screenshot overlay tests passed OK");
