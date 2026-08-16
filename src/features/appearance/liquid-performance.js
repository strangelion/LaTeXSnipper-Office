// Liquid Glass 2.0 performance tier resolution.
//
// Users keep the public auto | on | off switch. Internally the effective
// tier is full | reduced | static | off, derived from backdrop-filter
// support, reduced-motion preference, and device capacity. The tier drives
// how much of the fluid Dock is animated without changing the user-facing
// setting.

export const LIQUID_QUALITIES = Object.freeze({
  FULL: "full",
  REDUCED: "reduced",
  STATIC: "static",
  OFF: "off",
});

// Capacity thresholds, in cores / GiB.
const FULL_MIN_CORES = 8;
const FULL_MIN_MEMORY = 8;
const REDUCED_MIN_CORES = 4;
const REDUCED_MIN_MEMORY = 4;

/**
 * Resolve the effective quality tier from capabilities.
 *
 * @param {object} options
 * @param {string} options.requestedMode - public mode: auto | on | off
 * @param {boolean} options.supportsBackdropFilter
 * @param {boolean} options.prefersReducedMotion
 * @param {number|null} [options.hardwareConcurrency]
 * @param {number|null} [options.deviceMemory]
 * @returns {"full"|"reduced"|"static"|"off"}
 */
export function resolveLiquidQuality({
  requestedMode,
  supportsBackdropFilter,
  prefersReducedMotion,
  hardwareConcurrency = null,
  deviceMemory = null,
}) {
  if (requestedMode === "off") return LIQUID_QUALITIES.OFF;
  if (!supportsBackdropFilter) return LIQUID_QUALITIES.OFF;
  // Reduced motion keeps the glass material but stops fluid animation.
  if (prefersReducedMotion) return LIQUID_QUALITIES.STATIC;
  if (requestedMode === "on") return LIQUID_QUALITIES.FULL;

  const cores = hardwareConcurrency ?? 8;
  const memory = deviceMemory ?? 8;
  if (cores >= FULL_MIN_CORES && memory >= FULL_MIN_MEMORY) {
    return LIQUID_QUALITIES.FULL;
  }
  if (cores >= REDUCED_MIN_CORES && memory >= REDUCED_MIN_MEMORY) {
    return LIQUID_QUALITIES.REDUCED;
  }
  return LIQUID_QUALITIES.STATIC;
}

// Effective tier name shown in diagnostics.
export function liquidQualityLabel(quality) {
  switch (quality) {
    case LIQUID_QUALITIES.FULL:
      return "full";
    case LIQUID_QUALITIES.REDUCED:
      return "reduced";
    case LIQUID_QUALITIES.STATIC:
      return "static";
    default:
      return "off";
  }
}
