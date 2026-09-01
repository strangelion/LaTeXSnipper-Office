import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  loadAppearance,
  mixHex,
  normalizeAppearance,
  saveAppearance,
} from "../src/features/appearance/custom-theme.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function fakeRoot() {
  const properties = new Map();
  return {
    dataset: {},
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
      getPropertyValue: (key) => properties.get(key) ?? "",
    },
  };
}

test("appearance values are normalized before persistence", () => {
  const normalized = normalizeAppearance({
    palette: "custom",
    accent: "#ABCDEF",
    background: "invalid",
    iconScale: 999,
    backgroundImageOpacity: 0,
    backgroundImage: "javascript:alert(1)",
  });
  assert.equal(normalized.accent, "#abcdef");
  assert.equal(normalized.background, APPEARANCE_DEFAULTS.background);
  assert.equal(normalized.iconScale, 130);
  assert.equal(normalized.backgroundImageOpacity, 10);
  assert.equal(normalized.backgroundImage, "");
});

test("appearance settings round-trip through local storage", () => {
  const storage = memoryStorage();
  saveAppearance({ palette: "forest", iconStyle: "soft" }, storage);
  const loaded = loadAppearance(storage);
  assert.equal(loaded.palette, "forest");
  assert.equal(loaded.iconStyle, "soft");
});

test("appearance application writes only normalized CSS variables", () => {
  const root = fakeRoot();
  const applied = applyAppearance(
    {
      palette: "custom",
      accent: "#336699",
      background: "#101820",
      surface: "#1b2733",
      foreground: "#f2f6fa",
      backgroundStyle: "grid",
      iconStyle: "filled",
      iconScale: 115,
    },
    root,
  );
  assert.equal(applied.iconScale, 115);
  assert.equal(root.dataset.backgroundStyle, "grid");
  assert.equal(root.dataset.iconStyle, "filled");
  assert.equal(root.style.getPropertyValue("--accent"), "#336699");
  assert.equal(root.style.getPropertyValue("--bg"), "#101820");
  assert.equal(root.style.getPropertyValue("--appearance-icon-scale"), "1.15");
  assert.equal(mixHex("#336699", -0.18), "#2a547d");
});

test("appearance page exposes every persisted control", () => {
  const html = readFileSync(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  for (const id of [
    "appearancePalette",
    "appearanceAccentColor",
    "appearanceBackgroundColor",
    "appearanceSurfaceColor",
    "appearanceForegroundColor",
    "appearanceBackgroundStyle",
    "appearanceBackgroundFile",
    "appearanceImageOpacity",
    "appearanceIconStyle",
    "appearanceIconScale",
    "appearanceReset",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});
