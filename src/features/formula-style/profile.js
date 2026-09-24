const STORAGE_KEY = "latexsnipper.formula-style.v1";
export const FORMULA_STYLE_SCHEMA_VERSION = 1;

const MATH_RENDERER_FONTS = new Set(["mathjax-tex"]);
const FONT_WEIGHTS = new Set(["normal", "bold"]);
const MATH_VARIANTS = new Set(["tex", "roman", "italic"]);
const DISPLAY_MODES = new Set(["inline", "display", "numbered"]);
const ALIGNMENTS = new Set(["baseline", "left", "center", "right"]);
const OUTPUT_STRATEGIES = new Set(["editable", "fixed"]);

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};

const safeText = (value, fallback, maxLength = 80) => {
  const text = String(value ?? "").trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return fallback;
  return text.slice(0, maxLength);
};

const safeColor = (value, fallback = "#000000") => {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
};

const safeEnum = (value, allowed, fallback) =>
  allowed.has(value) ? value : fallback;

const clone = (value) => JSON.parse(JSON.stringify(value));

const profile = ({ id, name, math, layout, output }) => ({
  schemaVersion: FORMULA_STYLE_SCHEMA_VERSION,
  id,
  revision: 1,
  name,
  builtIn: true,
  math,
  layout,
  output,
  resources: {
    requiredFonts: [math.officeFont],
    customSymbolIds: [],
  },
});

export const BUILTIN_FORMULA_STYLES = Object.freeze(
  [
    profile({
      id: "builtin-inline",
      name: "正文行内",
      math: {
        rendererFont: "mathjax-tex",
        officeFont: "Cambria Math",
        textFont: "Microsoft YaHei",
        fontSizePt: 11,
        fontWeight: "normal",
        mathVariant: "tex",
        color: "#000000",
      },
      layout: {
        displayMode: "inline",
        alignment: "baseline",
        paragraphBeforePt: 0,
        paragraphAfterPt: 0,
        baselineShiftPt: 0,
        maxWidthPt: 480,
      },
      output: { strategy: "editable", background: "transparent" },
    }),
    profile({
      id: "builtin-paper",
      name: "论文行间",
      math: {
        rendererFont: "mathjax-tex",
        officeFont: "Cambria Math",
        textFont: "Microsoft YaHei",
        fontSizePt: 12,
        fontWeight: "normal",
        mathVariant: "tex",
        color: "#000000",
      },
      layout: {
        displayMode: "display",
        alignment: "center",
        paragraphBeforePt: 6,
        paragraphAfterPt: 6,
        baselineShiftPt: 0,
        maxWidthPt: 480,
      },
      output: { strategy: "editable", background: "transparent" },
    }),
    profile({
      id: "builtin-teaching",
      name: "教学演示",
      math: {
        rendererFont: "mathjax-tex",
        officeFont: "Cambria Math",
        textFont: "Microsoft YaHei",
        fontSizePt: 22,
        fontWeight: "bold",
        mathVariant: "tex",
        color: "#172033",
      },
      layout: {
        displayMode: "display",
        alignment: "center",
        paragraphBeforePt: 8,
        paragraphAfterPt: 8,
        baselineShiftPt: 0,
        maxWidthPt: 720,
      },
      output: { strategy: "fixed", background: "transparent" },
    }),
  ].map((item) => Object.freeze(item)),
);

export function normalizeFormulaStyleProfile(input = {}, fallback = null) {
  const base = clone(fallback || BUILTIN_FORMULA_STYLES[0]);
  const math = input.math || {};
  const layout = input.layout || {};
  const output = input.output || {};
  const officeFont = safeText(math.officeFont, base.math.officeFont, 64);
  return {
    schemaVersion: FORMULA_STYLE_SCHEMA_VERSION,
    id: safeText(input.id, base.id, 64).replace(/[^a-zA-Z0-9_-]/g, "-"),
    revision: Math.round(clamp(input.revision, 1, 1_000_000, 1)),
    name: safeText(input.name, base.name, 64),
    builtIn: Boolean(input.builtIn),
    math: {
      rendererFont: safeEnum(
        math.rendererFont,
        MATH_RENDERER_FONTS,
        base.math.rendererFont,
      ),
      officeFont,
      textFont: safeText(math.textFont, base.math.textFont, 64),
      fontSizePt: clamp(math.fontSizePt, 6, 72, base.math.fontSizePt),
      fontWeight: safeEnum(math.fontWeight, FONT_WEIGHTS, base.math.fontWeight),
      mathVariant: safeEnum(
        math.mathVariant,
        MATH_VARIANTS,
        base.math.mathVariant || "tex",
      ),
      color: safeColor(math.color, base.math.color),
    },
    layout: {
      displayMode: safeEnum(
        layout.displayMode,
        DISPLAY_MODES,
        base.layout.displayMode,
      ),
      alignment: safeEnum(layout.alignment, ALIGNMENTS, base.layout.alignment),
      paragraphBeforePt: clamp(
        layout.paragraphBeforePt,
        0,
        144,
        base.layout.paragraphBeforePt,
      ),
      paragraphAfterPt: clamp(
        layout.paragraphAfterPt,
        0,
        144,
        base.layout.paragraphAfterPt,
      ),
      baselineShiftPt: clamp(
        layout.baselineShiftPt,
        -36,
        36,
        base.layout.baselineShiftPt,
      ),
      maxWidthPt: clamp(layout.maxWidthPt, 72, 1440, base.layout.maxWidthPt),
    },
    output: {
      strategy: safeEnum(
        output.strategy,
        OUTPUT_STRATEGIES,
        base.output.strategy,
      ),
      background:
        output.background === "transparent"
          ? "transparent"
          : safeColor(output.background, base.output.background),
    },
    resources: {
      requiredFonts: [officeFont],
      customSymbolIds: Array.isArray(input.resources?.customSymbolIds)
        ? input.resources.customSymbolIds
            .map((item) => safeText(item, "", 80))
            .filter(Boolean)
            .slice(0, 256)
        : [],
    },
  };
}

export function formulaStyleSnapshot(input) {
  return normalizeFormulaStyleProfile(input);
}

function customProfileId() {
  const random = globalThis.crypto?.randomUUID?.() || Date.now().toString(36);
  return `style-${random}`;
}

export class FormulaStyleStore {
  constructor(storage = globalThis.localStorage, key = STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
    this.state = this.load();
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(this.storage?.getItem?.(this.key) || "null");
    } catch {
      saved = null;
    }
    const customProfiles = Array.isArray(saved?.profiles)
      ? saved.profiles
          .filter((item) => item?.builtIn !== true)
          .map((item) => normalizeFormulaStyleProfile(item))
      : [];
    const profiles = [...BUILTIN_FORMULA_STYLES.map(clone), ...customProfiles];
    const requested = String(saved?.activeProfileId || "builtin-inline");
    return {
      schemaVersion: FORMULA_STYLE_SCHEMA_VERSION,
      activeProfileId: profiles.some((item) => item.id === requested)
        ? requested
        : "builtin-inline",
      profiles,
    };
  }

  persist() {
    this.storage?.setItem?.(
      this.key,
      JSON.stringify({
        schemaVersion: FORMULA_STYLE_SCHEMA_VERSION,
        activeProfileId: this.state.activeProfileId,
        profiles: this.state.profiles.filter((item) => !item.builtIn),
      }),
    );
  }

  list() {
    return this.state.profiles.map(clone);
  }

  active() {
    return clone(
      this.state.profiles.find(
        (item) => item.id === this.state.activeProfileId,
      ) || BUILTIN_FORMULA_STYLES[0],
    );
  }

  select(id) {
    if (!this.state.profiles.some((item) => item.id === id)) {
      throw new Error("STYLE_PROFILE_NOT_FOUND");
    }
    this.state.activeProfileId = id;
    this.persist();
    return this.active();
  }

  saveAs(name, draft) {
    const normalized = normalizeFormulaStyleProfile({
      ...draft,
      id: customProfileId(),
      name,
      revision: 1,
      builtIn: false,
    });
    this.state.profiles.push(normalized);
    this.state.activeProfileId = normalized.id;
    this.persist();
    return clone(normalized);
  }

  update(id, draft) {
    const index = this.state.profiles.findIndex((item) => item.id === id);
    if (index < 0 || this.state.profiles[index].builtIn) return null;
    const normalized = normalizeFormulaStyleProfile({
      ...draft,
      id,
      revision: this.state.profiles[index].revision + 1,
      builtIn: false,
    });
    this.state.profiles[index] = normalized;
    this.state.activeProfileId = id;
    this.persist();
    return clone(normalized);
  }

  remove(id) {
    const target = this.state.profiles.find((item) => item.id === id);
    if (!target || target.builtIn) return false;
    this.state.profiles = this.state.profiles.filter((item) => item.id !== id);
    if (this.state.activeProfileId === id) {
      this.state.activeProfileId = "builtin-inline";
    }
    this.persist();
    return true;
  }

  exportBundle() {
    return JSON.stringify(
      {
        kind: "latexsnipper-formula-styles",
        schemaVersion: FORMULA_STYLE_SCHEMA_VERSION,
        profiles: this.state.profiles.filter((item) => !item.builtIn),
      },
      null,
      2,
    );
  }

  importBundle(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text));
    } catch {
      throw new Error("STYLE_BUNDLE_INVALID_JSON");
    }
    if (
      parsed?.kind !== "latexsnipper-formula-styles" ||
      parsed?.schemaVersion !== FORMULA_STYLE_SCHEMA_VERSION ||
      !Array.isArray(parsed?.profiles)
    ) {
      throw new Error("STYLE_BUNDLE_UNSUPPORTED");
    }
    const imported = parsed.profiles.slice(0, 100).map((item) =>
      normalizeFormulaStyleProfile({
        ...item,
        id: customProfileId(),
        builtIn: false,
      }),
    );
    this.state.profiles.push(...imported);
    if (imported[0]) this.state.activeProfileId = imported[0].id;
    this.persist();
    return imported.map(clone);
  }
}
