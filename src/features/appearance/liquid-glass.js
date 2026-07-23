// Liquid Glass appearance controller.
//
// Modes: auto | on | off
// Auto disables glass when backdrop-filter is unsupported, reduced-motion
// is preferred, or graphics capacity is limited.

const STORAGE_KEY = "latexsnipper.liquidGlassMode";
const MODES = new Set(["auto", "on", "off"]);
let currentMode = "auto";

function normalizeMode(value) {
  return MODES.has(value) ? value : "auto";
}

function supportsBackdropFilter() {
  return (
    CSS.supports("backdrop-filter", "blur(8px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(8px)")
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasEnoughGraphicsCapacity() {
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = navigator.deviceMemory ?? 8;
  return cores >= 4 && memory >= 4;
}

export function resolveLiquidGlass(requestedMode) {
  const mode = normalizeMode(requestedMode);
  if (mode === "on") return "on";
  if (mode === "off") return "off";
  if (!supportsBackdropFilter()) return "off";
  if (prefersReducedMotion()) {
    document.documentElement.dataset.reducedMotion = "true";
  }
  if (!hasEnoughGraphicsCapacity()) return "off";
  return "on";
}

export function applyLiquidGlassMode(requestedMode) {
  currentMode = normalizeMode(requestedMode);
  const resolved = resolveLiquidGlass(currentMode);
  const root = document.documentElement;
  root.dataset.liquidGlass = resolved;
  root.dataset.liquidGlassRequested = currentMode;
  window.dispatchEvent(
    new CustomEvent("latexsnipper:liquid-glass-change", {
      detail: { requested: currentMode, actual: resolved },
    }),
  );
  return { requested: currentMode, actual: resolved };
}

export function setLiquidGlassMode(mode) {
  const normalized = normalizeMode(mode);
  localStorage.setItem(STORAGE_KEY, normalized);
  return applyLiquidGlassMode(normalized);
}

export function getLiquidGlassMode() {
  return currentMode;
}

export function initLiquidGlass() {
  const stored = localStorage.getItem(STORAGE_KEY) ?? "auto";
  const result = applyLiquidGlassMode(stored);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.addEventListener("change", () => {
    if (currentMode === "auto") applyLiquidGlassMode("auto");
  });
  return result;
}

export function getLiquidGlassDiagnostics() {
  const root = document.documentElement;
  return {
    requested: root.dataset.liquidGlassRequested ?? "auto",
    actual: root.dataset.liquidGlass ?? "off",
    backdropFilter: supportsBackdropFilter(),
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    reducedMotion: prefersReducedMotion(),
  };
}
