import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFormulaPreferences,
  hydrateFormulaItems,
  formulaPreferenceId,
  loadFormulaPreferences,
  matchesFormulaPreferenceFilter,
  saveFormulaPreferences,
} from "../src/features/formula-library/preferences.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("formula preference ids remain stable across reloads", () => {
  assert.equal(
    formulaPreferenceId("analysis", "\\int_0^1 x\\,dx"),
    "analysis:\\int_0^1 x\\,dx",
  );
});

test("formula catalog rows hydrate into visible enabled records", () => {
  const records = hydrateFormulaItems("structures", [
    ["分数", "\\frac{#?}{#?}", "Fraction"],
    ["上标", "^{#?}", "Superscript"],
  ]);
  assert.deepEqual(
    records.map(({ label, latex, preference }) => ({
      label,
      latex,
      enabled: preference.enabled,
      hidden: preference.hidden,
    })),
    [
      { label: "分数", latex: "\\frac{#?}{#?}", enabled: true, hidden: false },
      { label: "上标", latex: "^{#?}", enabled: true, hidden: false },
    ],
  );
});

test("formula preferences persist without losing state", () => {
  const storage = memoryStorage();
  const state = {
    "analysis:x": { enabled: false, favorite: true, hidden: false },
  };
  saveFormulaPreferences(state, storage);
  assert.deepEqual(loadFormulaPreferences(storage), state);
});

test("disabled and hidden formulas have explicit recovery filters", () => {
  const disabled = { enabled: false, hidden: false };
  const hidden = { enabled: true, hidden: true };
  assert.equal(matchesFormulaPreferenceFilter(disabled, "all"), false);
  assert.equal(matchesFormulaPreferenceFilter(disabled, "disabled"), true);
  assert.equal(matchesFormulaPreferenceFilter(hidden, "hidden"), true);
});

test("pinned and favorite formulas sort ahead of frequent formulas", () => {
  const formulas = [
    { label: "频繁", preference: { usageCount: 20 } },
    { label: "收藏", preference: { favorite: true } },
    { label: "置顶", preference: { pinned: true } },
  ].sort(compareFormulaPreferences);
  assert.deepEqual(
    formulas.map((formula) => formula.label),
    ["置顶", "收藏", "频繁"],
  );
});
