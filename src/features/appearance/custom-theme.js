const STORAGE_KEY = "latexsnipper.appearance.v2";
const LEGACY_STORAGE_KEY = "latexsnipper.appearance.v1";
const MAX_BACKGROUND_BYTES = 1_500_000;
const ALLOWED_BACKGROUND_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const LIGHT_DEFAULTS = Object.freeze({
  accent: "#2563eb",
  background: "#f8fafc",
  surface: "#ffffff",
  foreground: "#0f172a",
});

const DARK_DEFAULTS = Object.freeze({
  accent: "#60a5fa",
  background: "#0f111a",
  surface: "#1e293b",
  foreground: "#e2e8f0",
});

export const APPEARANCE_DEFAULTS = Object.freeze({
  palette: "system",
  light: LIGHT_DEFAULTS,
  dark: DARK_DEFAULTS,
  backgroundStyle: "ambient",
  backgroundImage: "",
  backgroundImageOpacity: 82,
  iconStyle: "outline",
  iconScale: 100,
});

export const APPEARANCE_PALETTES = Object.freeze({
  ocean: {
    light: {
      accent: "#2563eb",
      background: "#eef6ff",
      surface: "#ffffff",
      foreground: "#10213a",
    },
    dark: {
      accent: "#60a5fa",
      background: "#0c1424",
      surface: "#17243a",
      foreground: "#e7f1ff",
    },
  },
  forest: {
    light: {
      accent: "#15803d",
      background: "#f0f8f2",
      surface: "#fbfffc",
      foreground: "#10291a",
    },
    dark: {
      accent: "#4ade80",
      background: "#0d1811",
      surface: "#17261c",
      foreground: "#e4f7e9",
    },
  },
  violet: {
    light: {
      accent: "#7c3aed",
      background: "#f6f2ff",
      surface: "#ffffff",
      foreground: "#24153d",
    },
    dark: {
      accent: "#a78bfa",
      background: "#141020",
      surface: "#211a33",
      foreground: "#f1ebff",
    },
  },
  rose: {
    light: {
      accent: "#db2777",
      background: "#fff1f7",
      surface: "#fffafd",
      foreground: "#3f1428",
    },
    dark: {
      accent: "#f472b6",
      background: "#1c0f16",
      surface: "#301923",
      foreground: "#ffe8f2",
    },
  },
  amber: {
    light: {
      accent: "#b45309",
      background: "#fff8e8",
      surface: "#fffdf8",
      foreground: "#38250d",
    },
    dark: {
      accent: "#fbbf24",
      background: "#1b150b",
      surface: "#2c2110",
      foreground: "#fff2ce",
    },
  },
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeHexColor(value, fallback) {
  const candidate = String(value ?? "").trim();
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeThemeColors(value, defaults) {
  const source = value && typeof value === "object" ? value : {};
  return {
    accent: normalizeHexColor(source.accent, defaults.accent),
    background: normalizeHexColor(source.background, defaults.background),
    surface: normalizeHexColor(source.surface, defaults.surface),
    foreground: normalizeHexColor(source.foreground, defaults.foreground),
  };
}

export function normalizeAppearance(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const palette =
    source.palette === "system" ||
    source.palette === "custom" ||
    Object.hasOwn(APPEARANCE_PALETTES, source.palette)
      ? source.palette
      : APPEARANCE_DEFAULTS.palette;
  const backgroundStyle = ["ambient", "solid", "grid", "image"].includes(
    source.backgroundStyle,
  )
    ? source.backgroundStyle
    : APPEARANCE_DEFAULTS.backgroundStyle;
  const iconStyle = ["outline", "soft", "filled", "minimal"].includes(
    source.iconStyle,
  )
    ? source.iconStyle
    : APPEARANCE_DEFAULTS.iconStyle;

  // v1 stored one light-oriented color set. Preserve it for light mode and
  // give dark mode an independent, readable palette during migration.
  const legacyLight = {
    accent: source.accent,
    background: source.background,
    surface: source.surface,
    foreground: source.foreground,
  };

  return {
    palette,
    light: normalizeThemeColors(source.light ?? legacyLight, LIGHT_DEFAULTS),
    dark: normalizeThemeColors(source.dark, DARK_DEFAULTS),
    backgroundStyle,
    backgroundImage:
      typeof source.backgroundImage === "string" &&
      source.backgroundImage.startsWith("data:image/")
        ? source.backgroundImage
        : "",
    backgroundImageOpacity: clampNumber(
      source.backgroundImageOpacity,
      10,
      100,
      APPEARANCE_DEFAULTS.backgroundImageOpacity,
    ),
    iconStyle,
    iconScale: clampNumber(
      source.iconScale,
      80,
      130,
      APPEARANCE_DEFAULTS.iconScale,
    ),
  };
}

export function resolvePalette(config, theme = "light") {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  if (config.palette === "system") return null;
  if (config.palette === "custom") return config[resolvedTheme];
  return APPEARANCE_PALETTES[config.palette]?.[resolvedTheme] ?? null;
}

function colorChannel(hex, start) {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

export function mixHex(hex, amount) {
  const color = normalizeHexColor(hex, LIGHT_DEFAULTS.accent);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.min(1, Math.abs(amount));
  const channel = (start) =>
    Math.round(colorChannel(color, start) * (1 - ratio) + target * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function luminance(hex) {
  const color = normalizeHexColor(hex, "#000000");
  const values = [1, 3, 5].map((start) => {
    const channel = colorChannel(color, start) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(first, second) {
  const high = Math.max(luminance(first), luminance(second));
  const low = Math.min(luminance(first), luminance(second));
  return (high + 0.05) / (low + 0.05);
}

export function ensureReadablePalette(palette) {
  const requested = palette.foreground;
  const backgrounds = [palette.background, palette.surface];
  const requestedRatio = Math.min(
    ...backgrounds.map((background) => contrastRatio(requested, background)),
  );
  if (requestedRatio >= 4.5) {
    return { ...palette, adjusted: false, contrast: requestedRatio };
  }
  const candidates = ["#0f172a", "#f8fafc"];
  const scored = candidates.map((foreground) => ({
    foreground,
    ratio: Math.min(
      ...backgrounds.map((background) => contrastRatio(foreground, background)),
    ),
  }));
  const best = scored.sort((a, b) => b.ratio - a.ratio)[0];
  return {
    ...palette,
    foreground: best.foreground,
    adjusted: true,
    contrast: best.ratio,
    requestedForeground: requested,
  };
}

export function applyAppearance(config, root = document.documentElement) {
  const normalized = normalizeAppearance(config);
  const theme = root.dataset.theme === "dark" ? "dark" : "light";
  const requestedPalette = resolvePalette(normalized, theme);
  const palette = requestedPalette
    ? ensureReadablePalette(requestedPalette)
    : null;
  const style = root.style;
  const colorProperties = [
    "--accent",
    "--accent-hover",
    "--bg",
    "--card-bg",
    "--surface-2",
    "--fg",
    "--text",
    "--muted",
    "--border-color",
    "--hdr-bg",
  ];

  if (!palette) {
    for (const property of colorProperties) style.removeProperty(property);
    delete root.dataset.appearanceContrastAdjusted;
  } else {
    style.setProperty("--accent", palette.accent);
    style.setProperty("--accent-hover", mixHex(palette.accent, -0.18));
    style.setProperty("--bg", palette.background);
    style.setProperty("--card-bg", palette.surface);
    style.setProperty("--surface-2", palette.surface);
    style.setProperty("--fg", palette.foreground);
    style.setProperty("--text", palette.foreground);
    style.setProperty(
      "--muted",
      theme === "dark"
        ? mixHex(palette.foreground, -0.34)
        : mixHex(palette.foreground, 0.36),
    );
    style.setProperty(
      "--border-color",
      theme === "dark"
        ? mixHex(palette.surface, 0.14)
        : mixHex(palette.foreground, 0.83),
    );
    style.setProperty(
      "--hdr-bg",
      `color-mix(in srgb, ${palette.surface} 86%, transparent)`,
    );
    root.dataset.appearanceContrastAdjusted = String(palette.adjusted);
  }

  root.dataset.appearancePalette = normalized.palette;
  root.dataset.appearanceResolvedTheme = theme;
  root.dataset.backgroundStyle = normalized.backgroundStyle;
  root.dataset.iconStyle = normalized.iconStyle;
  style.setProperty(
    "--appearance-icon-scale",
    String(normalized.iconScale / 100),
  );
  style.setProperty(
    "--appearance-background-image-opacity",
    String(normalized.backgroundImageOpacity / 100),
  );
  if (normalized.backgroundStyle === "image" && normalized.backgroundImage) {
    style.setProperty(
      "--appearance-background-image",
      `url("${normalized.backgroundImage}")`,
    );
  } else {
    style.removeProperty("--appearance-background-image");
  }
  return normalized;
}

export function loadAppearance(storage = localStorage) {
  try {
    const serialized =
      storage.getItem(STORAGE_KEY) ??
      storage.getItem(LEGACY_STORAGE_KEY) ??
      "{}";
    return normalizeAppearance(JSON.parse(serialized));
  } catch {
    return normalizeAppearance(APPEARANCE_DEFAULTS);
  }
}

export function saveAppearance(config, storage = localStorage) {
  const normalized = normalizeAppearance(config);
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function setSelectValue(select, value) {
  if (select) select.value = value;
}

function syncColorField(name, value) {
  const picker = document.getElementById(`appearance${name}Color`);
  const text = document.getElementById(`appearance${name}Hex`);
  if (picker) picker.value = value;
  if (text) text.value = value.toUpperCase();
}

function renderThemePreview(theme, palette) {
  const preview = document.querySelector(
    `[data-appearance-preview="${theme}"]`,
  );
  if (!preview || !palette) return;
  const safe = ensureReadablePalette(palette);
  preview.style.setProperty("--preview-accent", safe.accent);
  preview.style.setProperty("--preview-bg", safe.background);
  preview.style.setProperty("--preview-surface", safe.surface);
  preview.style.setProperty("--preview-fg", safe.foreground);
}

function updateControls(config, editingTheme = "light", themeMode = "light") {
  setSelectValue(document.getElementById("appearanceThemeMode"), themeMode);
  setSelectValue(
    document.getElementById("appearanceEditingTheme"),
    editingTheme,
  );
  setSelectValue(document.getElementById("appearancePalette"), config.palette);
  setSelectValue(
    document.getElementById("appearanceBackgroundStyle"),
    config.backgroundStyle,
  );
  setSelectValue(
    document.getElementById("appearanceIconStyle"),
    config.iconStyle,
  );
  const colors = config[editingTheme];
  syncColorField("Accent", colors.accent);
  syncColorField("Background", colors.background);
  syncColorField("Surface", colors.surface);
  syncColorField("Foreground", colors.foreground);
  const imageOpacity = document.getElementById("appearanceImageOpacity");
  const imageOpacityValue = document.getElementById(
    "appearanceImageOpacityValue",
  );
  if (imageOpacity) imageOpacity.value = String(config.backgroundImageOpacity);
  if (imageOpacityValue)
    imageOpacityValue.textContent = `${config.backgroundImageOpacity}%`;
  const iconScale = document.getElementById("appearanceIconScale");
  const iconScaleValue = document.getElementById("appearanceIconScaleValue");
  if (iconScale) iconScale.value = String(config.iconScale);
  if (iconScaleValue) iconScaleValue.textContent = `${config.iconScale}%`;
  document
    .getElementById("appearanceCustomColors")
    ?.toggleAttribute("hidden", config.palette !== "custom");
  document
    .getElementById("appearanceImageControls")
    ?.toggleAttribute("hidden", config.backgroundStyle !== "image");
  const imageState = document.getElementById("appearanceImageState");
  if (imageState) {
    imageState.textContent = config.backgroundImage
      ? "已加载本地背景（仅保存在本机）"
      : "尚未选择背景图片";
  }
  renderThemePreview(
    "light",
    resolvePalette(config, "light") ?? LIGHT_DEFAULTS,
  );
  renderThemePreview("dark", resolvePalette(config, "dark") ?? DARK_DEFAULTS);
  const selectedPalette = ensureReadablePalette(
    resolvePalette(config, editingTheme) ?? config[editingTheme],
  );
  const contrastStatus = document.getElementById("appearanceContrastStatus");
  if (contrastStatus) {
    contrastStatus.textContent = selectedPalette.adjusted
      ? `当前文字对比度不足，应用时自动保护为 ${selectedPalette.foreground.toUpperCase()}`
      : `当前文字对比度 ${selectedPalette.contrast.toFixed(1)}:1，阅读清晰`;
    contrastStatus.dataset.tone = selectedPalette.adjusted ? "warning" : "ok";
  }
}

function bindColorPair(name, preview, commit) {
  const picker = document.getElementById(`appearance${name}Color`);
  const text = document.getElementById(`appearance${name}Hex`);
  const key = name.charAt(0).toLowerCase() + name.slice(1);
  picker?.addEventListener("input", () => {
    if (text) text.value = picker.value.toUpperCase();
    preview(key, picker.value);
  });
  picker?.addEventListener("change", () => commit(key, picker.value));
  text?.addEventListener("change", () => {
    const value = normalizeHexColor(text.value, picker?.value || "#000000");
    text.value = value.toUpperCase();
    if (picker) picker.value = value;
    commit(key, value);
  });
  text?.addEventListener("input", () => {
    const value = String(text.value).trim();
    if (!HEX_COLOR.test(value)) return;
    if (picker) picker.value = value;
    commit(key, value);
  });
}

export function initAppearanceSettings({
  notify = () => {},
  getThemeMode = () => "light",
  setThemeMode = () => {},
} = {}) {
  let config = applyAppearance(loadAppearance());
  let editingTheme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  let previewFrame = 0;

  const preview = (patch) => {
    config = normalizeAppearance({ ...config, ...patch });
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => {
      applyAppearance(config);
      updateControls(config, editingTheme, getThemeMode());
    });
  };

  const commit = (patch, message = "") => {
    try {
      config = saveAppearance({ ...config, ...patch });
      applyAppearance(config);
      updateControls(config, editingTheme, getThemeMode());
      window.dispatchEvent(
        new CustomEvent("latexsnipper:appearance-change", {
          detail: { ...config },
        }),
      );
      if (message) notify(message);
    } catch (error) {
      notify(
        `外观设置保存失败：${error instanceof Error ? error.message : error}`,
      );
    }
  };

  const patchEditingTheme = (key, value) => ({
    palette: "custom",
    [editingTheme]: { ...config[editingTheme], [key]: value },
  });

  updateControls(config, editingTheme, getThemeMode());
  document
    .getElementById("appearanceThemeMode")
    ?.addEventListener("change", (event) => {
      setThemeMode(event.currentTarget.value);
      updateControls(config, editingTheme, getThemeMode());
    });
  document
    .getElementById("appearanceEditingTheme")
    ?.addEventListener("change", (event) => {
      editingTheme = event.currentTarget.value === "dark" ? "dark" : "light";
      updateControls(config, editingTheme, getThemeMode());
    });
  document
    .getElementById("appearancePalette")
    ?.addEventListener("change", (event) =>
      commit({ palette: event.currentTarget.value }),
    );
  document
    .getElementById("appearanceBackgroundStyle")
    ?.addEventListener("change", (event) =>
      commit({ backgroundStyle: event.currentTarget.value }),
    );
  document
    .getElementById("appearanceIconStyle")
    ?.addEventListener("change", (event) =>
      commit({ iconStyle: event.currentTarget.value }),
    );
  document
    .getElementById("appearanceImageOpacity")
    ?.addEventListener("input", (event) => {
      const value = event.currentTarget.value;
      document.getElementById("appearanceImageOpacityValue").textContent =
        `${value}%`;
      preview({ backgroundImageOpacity: value });
    });
  document
    .getElementById("appearanceImageOpacity")
    ?.addEventListener("change", (event) =>
      commit({ backgroundImageOpacity: event.currentTarget.value }),
    );
  document
    .getElementById("appearanceIconScale")
    ?.addEventListener("input", (event) => {
      const value = event.currentTarget.value;
      document.getElementById("appearanceIconScaleValue").textContent =
        `${value}%`;
      preview({ iconScale: value });
    });
  document
    .getElementById("appearanceIconScale")
    ?.addEventListener("change", (event) =>
      commit({ iconScale: event.currentTarget.value }),
    );
  for (const name of ["Accent", "Background", "Surface", "Foreground"]) {
    bindColorPair(
      name,
      (key, value) => preview(patchEditingTheme(key, value)),
      (key, value) => commit(patchEditingTheme(key, value)),
    );
  }

  window.addEventListener("latexsnipper:theme-change", () => {
    applyAppearance(config);
    updateControls(config, editingTheme, getThemeMode());
  });

  document
    .getElementById("appearanceBackgroundFile")
    ?.addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      if (!ALLOWED_BACKGROUND_TYPES.has(file.type)) {
        notify("请选择 PNG、JPEG 或 WebP 图片");
        event.currentTarget.value = "";
        return;
      }
      if (file.size > MAX_BACKGROUND_BYTES) {
        notify("背景图片需小于 1.5 MB，以免设置存储失效");
        event.currentTarget.value = "";
        return;
      }
      try {
        const backgroundImage = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(String(reader.result)));
          reader.addEventListener("error", () => reject(reader.error));
          reader.readAsDataURL(file);
        });
        commit({ backgroundStyle: "image", backgroundImage }, "本地背景已应用");
      } catch (error) {
        notify(
          `背景图片读取失败：${error instanceof Error ? error.message : error}`,
        );
      }
      event.currentTarget.value = "";
    });
  document
    .getElementById("appearanceClearBackground")
    ?.addEventListener("click", () =>
      commit(
        { backgroundImage: "", backgroundStyle: "ambient" },
        "背景图片已清除",
      ),
    );
  document.getElementById("appearanceReset")?.addEventListener("click", () => {
    setThemeMode("system");
    config = saveAppearance(APPEARANCE_DEFAULTS);
    applyAppearance(config);
    updateControls(config, editingTheme, getThemeMode());
    notify("外观设置已恢复默认并重新跟随系统明暗模式");
  });

  return {
    get value() {
      return { ...config };
    },
    apply: (patch) => commit(patch),
  };
}
