import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  contrastRatio,
  ensureReadablePalette,
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
  assert.equal(normalized.light.accent, "#abcdef");
  assert.equal(
    normalized.light.background,
    APPEARANCE_DEFAULTS.light.background,
  );
  assert.deepEqual(normalized.dark, APPEARANCE_DEFAULTS.dark);
  assert.equal(normalized.iconScale, 130);
  assert.equal(normalized.backgroundImageOpacity, 10);
  assert.equal(normalized.backgroundImage, "");
});

test("appearance settings round-trip through local storage", () => {
  const storage = memoryStorage();
  saveAppearance(
    {
      palette: "custom",
      iconStyle: "soft",
      light: { accent: "#123456" },
      dark: { accent: "#abcdef" },
    },
    storage,
  );
  const loaded = loadAppearance(storage);
  assert.equal(loaded.palette, "custom");
  assert.equal(loaded.iconStyle, "soft");
  assert.equal(loaded.light.accent, "#123456");
  assert.equal(loaded.dark.accent, "#abcdef");
});

test("v1 single-palette settings migrate to light mode without polluting dark mode", () => {
  const storage = memoryStorage({
    "latexsnipper.appearance.v1": JSON.stringify({
      palette: "custom",
      accent: "#7c3aed",
      background: "#f6f2ff",
      surface: "#ffffff",
      foreground: "#24153d",
    }),
  });
  const loaded = loadAppearance(storage);
  assert.equal(loaded.light.accent, "#7c3aed");
  assert.equal(loaded.dark.background, APPEARANCE_DEFAULTS.dark.background);
  assert.equal(loaded.dark.foreground, APPEARANCE_DEFAULTS.dark.foreground);
});

test("appearance application writes only normalized CSS variables", () => {
  const root = fakeRoot();
  const applied = applyAppearance(
    {
      palette: "custom",
      light: {
        accent: "#336699",
        background: "#101820",
        surface: "#1b2733",
        foreground: "#f2f6fa",
      },
      dark: {
        accent: "#abcdef",
        background: "#080b10",
        surface: "#111827",
        foreground: "#f8fafc",
      },
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

test("appearance resolves independent dark colors after theme changes", () => {
  const root = fakeRoot();
  root.dataset.theme = "dark";
  applyAppearance(
    {
      palette: "custom",
      light: {
        accent: "#2563eb",
        background: "#ffffff",
        surface: "#f8fafc",
        foreground: "#111827",
      },
      dark: {
        accent: "#f59e0b",
        background: "#101010",
        surface: "#202020",
        foreground: "#f5f5f5",
      },
    },
    root,
  );
  assert.equal(root.style.getPropertyValue("--accent"), "#f59e0b");
  assert.equal(root.style.getPropertyValue("--bg"), "#101010");
  assert.equal(root.style.getPropertyValue("--fg"), "#f5f5f5");
  assert.equal(root.dataset.appearanceResolvedTheme, "dark");
});

test("low contrast custom text receives a readable applied fallback", () => {
  const safe = ensureReadablePalette({
    accent: "#2563eb",
    background: "#ffffff",
    surface: "#f8fafc",
    foreground: "#eeeeee",
  });
  assert.equal(safe.adjusted, true);
  assert.ok(contrastRatio(safe.foreground, "#ffffff") >= 4.5);
});

test("appearance page exposes every persisted control", () => {
  const html = readFileSync(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  for (const id of [
    "appearancePalette",
    "appearanceThemeMode",
    "appearanceEditingTheme",
    "appearanceAccentColor",
    "appearanceBackgroundColor",
    "appearanceSurfaceColor",
    "appearanceForegroundColor",
    "appearanceBackgroundStyle",
    "appearanceBackgroundFile",
    "appearanceImageOpacity",
    "appearanceIconStyle",
    "appearanceIconScale",
    "appearanceContrastStatus",
    "appearanceReset",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("appearance reset also restores system theme mode", () => {
  const source = readFileSync(
    new URL("../src/features/appearance/custom-theme.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /appearanceReset[\s\S]*setThemeMode\("system"\)[\s\S]*saveAppearance\(APPEARANCE_DEFAULTS\)/,
  );
});
