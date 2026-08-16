// Liquid Glass appearance controller.
//
// Public modes: auto | on | off
// Effective quality (internal): full | reduced | static | off
//   - off:   glass disabled (requested off, or backdrop-filter unsupported)
//   - static: glass material kept, fluid animation stopped (reduced motion /
//            very low-end devices)
//   - reduced: blur + lens sliding kept, per-frame sheen/deformation dropped
//   - full:  complete fluid Dock experience

import { resolveLiquidQuality } from "./liquid-performance.js";

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

function deviceCapacity() {
  return {
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
  };
}

export function resolveLiquidGlass(requestedMode) {
  const mode = normalizeMode(requestedMode);
  const quality = resolveLiquidQuality({
    requestedMode: mode,
    supportsBackdropFilter: supportsBackdropFilter(),
    prefersReducedMotion: prefersReducedMotion(),
    ...deviceCapacity(),
  });
  return quality === "off" ? "off" : "on";
}

export function applyLiquidGlassMode(requestedMode) {
  currentMode = normalizeMode(requestedMode);
  const quality = resolveLiquidQuality({
    requestedMode: currentMode,
    supportsBackdropFilter: supportsBackdropFilter(),
    prefersReducedMotion: prefersReducedMotion(),
    ...deviceCapacity(),
  });
  const resolved = quality === "off" ? "off" : "on";
  const root = document.documentElement;
  root.dataset.liquidGlass = resolved;
  root.dataset.liquidGlassRequested = currentMode;
  root.dataset.liquidQuality = quality;
  window.dispatchEvent(
    new CustomEvent("latexsnipper:liquid-glass-change", {
      detail: { requested: currentMode, actual: resolved, quality },
    }),
  );
  return { requested: currentMode, actual: resolved, quality };
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
    quality: root.dataset.liquidQuality ?? "off",
    backdropFilter: supportsBackdropFilter(),
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    reducedMotion: prefersReducedMotion(),
  };
}
