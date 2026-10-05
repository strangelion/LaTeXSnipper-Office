// Opt-in, bounded local preference selector. Never stores document/formula text.
const STORAGE_KEY = "latexsnipper.formula-completion-preferences.v1";
const MAX_SEQUENCE = 100000000;

export function createCompletionSelector(labels, storage) {
  const catalog = labels.slice(0, 64);
  const catalogId = catalog.join("\n");
  const freshState = () => ({
    version: 1,
    catalog: catalogId,
    enabled: false,
    sequence: 0,
    entries: {},
  });
  let state = freshState();
  const validNumber = (value, max) =>
    Number.isInteger(value) && value >= 0 && value <= max;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.length > 65536) throw new Error("Oversized selector state");
      const value = JSON.parse(raw);
      if (
        value?.version !== 1 ||
        value.catalog !== catalogId ||
        typeof value.enabled !== "boolean" ||
        !validNumber(value.sequence, MAX_SEQUENCE) ||
        !value.entries ||
        typeof value.entries !== "object" ||
        Array.isArray(value.entries)
      )
        throw new Error("Invalid selector state");
      const entries = {};
      for (const [key, entry] of Object.entries(value.entries)) {
        if (
          !/^c\d+$/.test(key) ||
          Number(key.slice(1)) >= catalog.length ||
          !validNumber(entry?.count, 100) ||
          !validNumber(entry?.last, value.sequence)
        )
          throw new Error("Invalid selector entry");
        entries[key] = { count: entry.count, last: entry.last };
      }
      state = {
        version: 1,
        catalog: catalogId,
        enabled: value.enabled,
        sequence: value.sequence,
        entries,
      };
    }
  } catch {
    // Corrupt or inaccessible preference storage falls back to the fixed catalog.
  }
  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* Memory-only fallback. */
    }
  };
  return {
    get enabled() {
      return state.enabled;
    },
    setEnabled(enabled) {
      state.enabled = enabled === true;
      save();
    },
    reset() {
      state = freshState();
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        /* Memory-only fallback. */
      }
    },
    rank() {
      return catalog.map((label, index) => {
        const entry = state.enabled ? state.entries[`c${index}`] : undefined;
        const score = entry?.count
          ? Math.min(
              8,
              2 * Math.log2(1 + entry.count) +
                1 / (1 + state.sequence - entry.last),
            )
          : 0;
        return { label, boost: score, detail: score ? "本地偏好" : "固定候选" };
      });
    },
    accept(label) {
      const index = catalog.indexOf(label);
      if (!state.enabled || index < 0 || state.sequence >= MAX_SEQUENCE)
        return null;
      const id = `c${index}`;
      const previous = state.entries[id] ? { ...state.entries[id] } : null;
      const sequence = ++state.sequence;
      state.entries[id] = {
        count: Math.min(100, (previous?.count || 0) + 1),
        last: sequence,
      };
      save();
      return { id, previous, sequence };
    },
    undo(token) {
      if (
        !state.enabled ||
        !token ||
        state.entries[token.id]?.last !== token.sequence
      )
        return;
      if (token.previous) state.entries[token.id] = token.previous;
      else delete state.entries[token.id];
      save();
    },
  };
}
