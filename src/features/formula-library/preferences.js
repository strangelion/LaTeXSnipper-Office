export const FORMULA_PREFERENCES_KEY = "latexsnipper.formula-preferences.v1";

/**
 * Stable identity of a built-in formula: the category plus its semantic
 * label, NOT its LaTeX body — so editing the LaTeX (e.g. \frac → \dfrac)
 * does not silently orphan the user's favorite/pin/hide/usage state.
 * Duplicate labels inside one category get a 1-based occurrence suffix.
 */
export function formulaStableId(categoryId, label, occurrenceIndex = 0) {
  const safeLabel = String(label || "")
    .replace(/:/g, "·")
    .trim();
  const base = `${categoryId}:${safeLabel}`;
  return occurrenceIndex > 0 ? `${base}#${occurrenceIndex}` : base;
}

/**
 * Legacy (v1) identity keyed by the raw LaTeX body. Kept only to migrate
 * preferences recorded before stable IDs existed.
 */
export function legacyFormulaId(categoryId, latex) {
  return `${categoryId}:${latex}`;
}

export function loadFormulaPreferences(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(
      storage?.getItem(FORMULA_PREFERENCES_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function saveFormulaPreferences(
  preferences,
  storage = globalThis.localStorage,
) {
  storage?.setItem(FORMULA_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function defaultFormulaPreference() {
  return {
    enabled: true,
    favorite: false,
    pinned: false,
    hidden: false,
    usageCount: 0,
    lastUsedAt: 0,
  };
}

export function normalizeFormulaPreference(value) {
  return {
    ...defaultFormulaPreference(),
    ...(value && typeof value === "object" ? value : {}),
  };
}

export function createFormulaRecord(
  categoryId,
  label,
  latex,
  preferences = {},
  occurrenceIndex = 0,
) {
  const id = formulaStableId(categoryId, label, occurrenceIndex);
  const legacyId = legacyFormulaId(categoryId, latex);
  const stored = preferences[id] ?? preferences[legacyId];
  if (stored && preferences[legacyId] && !preferences[id]) {
    // One-time migration: promote the legacy (LaTeX-keyed) record to the
    // stable label key so existing favorites survive the ID change.
    preferences[id] = stored;
    delete preferences[legacyId];
  }
  return {
    id,
    categoryId,
    label,
    latex,
    preference: normalizeFormulaPreference(stored),
  };
}

export function hydrateFormulaItems(categoryId, items, preferences = {}) {
  const seen = new Map();
  return (Array.isArray(items) ? items : [])
    .filter(
      (item) =>
        Array.isArray(item) &&
        typeof item[0] === "string" &&
        typeof item[1] === "string",
    )
    .map((item) => {
      const label = item[0];
      const occurrence = seen.get(label) || 0;
      seen.set(label, occurrence + 1);
      return createFormulaRecord(
        categoryId,
        label,
        item[1],
        preferences,
        occurrence,
      );
    });
}

export function matchesFormulaPreferenceFilter(preference, filter) {
  const state = normalizeFormulaPreference(preference);
  if (filter === "favorites") return state.favorite && !state.hidden;
  if (filter === "pinned") return state.pinned && !state.hidden;
  if (filter === "disabled") return !state.enabled && !state.hidden;
  if (filter === "hidden") return state.hidden;
  return state.enabled && !state.hidden;
}

export function compareFormulaPreferences(left, right) {
  const a = normalizeFormulaPreference(left.preference);
  const b = normalizeFormulaPreference(right.preference);
  return (
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.favorite) - Number(a.favorite) ||
    b.usageCount - a.usageCount ||
    b.lastUsedAt - a.lastUsedAt ||
    left.label.localeCompare(right.label, "zh-CN")
  );
}
