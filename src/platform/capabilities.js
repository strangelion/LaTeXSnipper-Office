export const SUPPORT_LEVELS = Object.freeze([
  "unsupported",
  "available",
  "experimental",
  "requiresSetup",
  "blocked",
]);

export const FEATURE_KEYS = Object.freeze([
  "nativeOle",
  "ommlInsert",
  "officeSelectionRead",
  "screenshot",
  "screenshotMultiMonitor",
  "screenshotWaylandPortal",
  "directMl",
  "coreMl",
  "cuda",
  "namedPipe",
  "officeJs",
  "globalShortcut",
  "secureCredentialStore",
]);

export function capability(level, options = {}) {
  if (!SUPPORT_LEVELS.includes(level)) {
    throw new TypeError(`Unknown support level: ${level}`);
  }
  return Object.freeze({
    level,
    ...(options.code ? { code: options.code } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.nextAction ? { nextAction: options.nextAction } : {}),
  });
}

export function unsupported(message = "This feature is not supported here.") {
  return capability("unsupported", {
    code: "PLATFORM_FEATURE_UNSUPPORTED",
    message,
  });
}

export function emptyFeatureCapabilities() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, unsupported()]));
}

export function mergeFeatureCapabilities(...patches) {
  return Object.assign(emptyFeatureCapabilities(), ...patches);
}

export function featureIsUsable(feature) {
  return feature?.level === "available" || feature?.level === "experimental";
}
