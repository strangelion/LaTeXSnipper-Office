export const FORMULA_PREFERENCES_KEY = "latexsnipper.formula-preferences.v1";

export function formulaPreferenceId(categoryId, latex) {
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
) {
  const id = formulaPreferenceId(categoryId, latex);
  return {
    id,
    categoryId,
    label,
    latex,
    preference: normalizeFormulaPreference(preferences[id]),
  };
}

export function hydrateFormulaItems(categoryId, items, preferences = {}) {
  return (Array.isArray(items) ? items : [])
    .filter(
      (item) =>
        Array.isArray(item) &&
        typeof item[0] === "string" &&
        typeof item[1] === "string",
    )
    .map((item) =>
      createFormulaRecord(categoryId, item[0], item[1], preferences),
    );
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
