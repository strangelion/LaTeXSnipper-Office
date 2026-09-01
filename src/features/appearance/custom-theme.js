const STORAGE_KEY = "latexsnipper.appearance.v1";
const MAX_BACKGROUND_BYTES = 1_500_000;
const ALLOWED_BACKGROUND_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const APPEARANCE_DEFAULTS = Object.freeze({
  palette: "system",
  accent: "#2563eb",
  background: "#f8fafc",
  surface: "#ffffff",
  foreground: "#0f172a",
  backgroundStyle: "ambient",
  backgroundImage: "",
  backgroundImageOpacity: 82,
  iconStyle: "outline",
  iconScale: 100,
});

export const APPEARANCE_PALETTES = Object.freeze({
  ocean: {
    accent: "#2563eb",
    background: "#eef6ff",
    surface: "#ffffff",
    foreground: "#10213a",
  },
  forest: {
    accent: "#15803d",
    background: "#f0f8f2",
    surface: "#fbfffc",
    foreground: "#10291a",
  },
  violet: {
    accent: "#7c3aed",
    background: "#f6f2ff",
    surface: "#ffffff",
    foreground: "#24153d",
  },
  rose: {
    accent: "#db2777",
    background: "#fff1f7",
    surface: "#fffafd",
    foreground: "#3f1428",
  },
  amber: {
    accent: "#b45309",
    background: "#fff8e8",
    surface: "#fffdf8",
    foreground: "#38250d",
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

  return {
    palette,
    accent: normalizeHexColor(source.accent, APPEARANCE_DEFAULTS.accent),
    background: normalizeHexColor(
      source.background,
      APPEARANCE_DEFAULTS.background,
    ),
    surface: normalizeHexColor(source.surface, APPEARANCE_DEFAULTS.surface),
    foreground: normalizeHexColor(
      source.foreground,
      APPEARANCE_DEFAULTS.foreground,
    ),
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

export function resolvePalette(config) {
  if (config.palette === "system") return null;
  if (config.palette === "custom") {
    return {
      accent: config.accent,
      background: config.background,
      surface: config.surface,
      foreground: config.foreground,
    };
  }
  return APPEARANCE_PALETTES[config.palette] ?? null;
}

function colorChannel(hex, start) {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

export function mixHex(hex, amount) {
  const color = normalizeHexColor(hex, APPEARANCE_DEFAULTS.accent);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.min(1, Math.abs(amount));
  const channel = (start) =>
    Math.round(colorChannel(color, start) * (1 - ratio) + target * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function applyAppearance(config, root = document.documentElement) {
  const normalized = normalizeAppearance(config);
  const palette = resolvePalette(normalized);
  const style = root.style;
  const properties = [
    "--accent",
    "--accent-hover",
    "--bg",
    "--card-bg",
    "--surface-2",
    "--fg",
    "--text",
    "--appearance-background-image",
    "--appearance-background-image-opacity",
    "--appearance-icon-scale",
  ];

  if (!palette) {
    for (const property of properties.slice(0, 7)) {
      style.removeProperty(property);
    }
  } else {
    style.setProperty("--accent", palette.accent);
    style.setProperty("--accent-hover", mixHex(palette.accent, -0.18));
    style.setProperty("--bg", palette.background);
    style.setProperty("--card-bg", palette.surface);
    style.setProperty("--surface-2", palette.surface);
    style.setProperty("--fg", palette.foreground);
    style.setProperty("--text", palette.foreground);
  }

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
    return normalizeAppearance(
      JSON.parse(storage.getItem(STORAGE_KEY) || "{}"),
    );
  } catch {
    return { ...APPEARANCE_DEFAULTS };
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

function updateControls(config) {
  setSelectValue(document.getElementById("appearancePalette"), config.palette);
  setSelectValue(
    document.getElementById("appearanceBackgroundStyle"),
    config.backgroundStyle,
  );
  setSelectValue(
    document.getElementById("appearanceIconStyle"),
    config.iconStyle,
  );
  syncColorField("Accent", config.accent);
  syncColorField("Background", config.background);
  syncColorField("Surface", config.surface);
  syncColorField("Foreground", config.foreground);
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
}

function bindColorPair(name, preview, commit) {
  const picker = document.getElementById(`appearance${name}Color`);
  const text = document.getElementById(`appearance${name}Hex`);
  const key = name.charAt(0).toLowerCase() + name.slice(1);
  picker?.addEventListener("input", () => {
    if (text) text.value = picker.value.toUpperCase();
    preview({ [key]: picker.value });
  });
  picker?.addEventListener("change", () => {
    commit({ [key]: picker.value });
  });
  text?.addEventListener("change", () => {
    const value = normalizeHexColor(text.value, picker?.value || "#000000");
    text.value = value.toUpperCase();
    if (picker) picker.value = value;
    commit({ [key]: value });
  });
}

export function initAppearanceSettings({ notify = () => {} } = {}) {
  let config = applyAppearance(loadAppearance());
  let previewFrame = 0;

  const preview = (patch) => {
    config = normalizeAppearance({ ...config, ...patch });
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => applyAppearance(config));
  };

  const commit = (patch, message = "") => {
    try {
      config = saveAppearance({ ...config, ...patch });
      applyAppearance(config);
      updateControls(config);
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

  updateControls(config);
  document
    .getElementById("appearancePalette")
    ?.addEventListener("change", (event) => {
      const palette = event.currentTarget.value;
      const preset = APPEARANCE_PALETTES[palette];
      commit(preset ? { palette, ...preset } : { palette });
    });
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
      (patch) => preview({ palette: "custom", ...patch }),
      (patch) => commit({ palette: "custom", ...patch }),
    );
  }

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
    config = saveAppearance(APPEARANCE_DEFAULTS);
    applyAppearance(config);
    updateControls(config);
    notify("外观设置已恢复默认");
  });

  return {
    get value() {
      return { ...config };
    },
    apply: (patch) => commit(patch),
  };
}
