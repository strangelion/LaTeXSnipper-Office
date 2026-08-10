import assert from "node:assert/strict";
import test from "node:test";
import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  spectrumPoint,
  spectrumPointInside,
} from "../src/features/custom-symbols/color-picker.js";

test("visual color picker preserves precise hexadecimal colors", () => {
  assert.equal(normalizeHexColor("#7c3aed"), "#7C3AED");
  assert.equal(normalizeHexColor("blue"), "#18212F");
  assert.equal(hsvToHex(hexToHsv("#2563EB")), "#2563EB");
});

test("saturation and value selection clamps to the visual field", () => {
  const bounds = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(spectrumPoint(200, 100, bounds), {
    saturation: 0.5,
    value: 0.5,
  });
  assert.deepEqual(spectrumPoint(500, -20, bounds), {
    saturation: 1,
    value: 1,
  });
});

test("visual color dragging preserves the last valid color outside the field", () => {
  const bounds = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(spectrumPointInside(150, 75, bounds), {
    saturation: 0.25,
    value: 0.75,
  });
  assert.equal(spectrumPointInside(99, 75, bounds), null);
  assert.equal(spectrumPointInside(150, 151, bounds), null);
});

test("color controls use painted tracks instead of invisible native ranges", async () => {
  const css = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/styles/main.css", import.meta.url), "utf8"),
  );
  assert.match(css, /input\.symbol-color-hue::\-webkit-slider-runnable-track/);
  assert.match(css, /background:\s*var\(--symbol-range-track\)/);
  assert.match(css, /\.symbol-color-control\s*\{[\s\S]*?display:\s*grid/);
});
