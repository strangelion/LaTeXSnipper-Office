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
    ...(options.backend ? { backend: options.backend } : {}),
    ...(options.staticSupport ? { staticSupport: options.staticSupport } : {}),
    ...(options.installedBackend
      ? { installedBackend: options.installedBackend }
      : {}),
    ...(options.runtimeHealth ? { runtimeHealth: options.runtimeHealth } : {}),
  });
}

export function layeredCapability({
  staticSupported,
  installedBackend,
  runtimeHealthy,
  message,
  nextAction,
  backend,
}) {
  if (!staticSupported) return unsupported(message);
  const layers = {
    staticSupport: "supported",
    installedBackend:
      installedBackend === true
        ? "installed"
        : installedBackend === false
          ? "missing"
          : "unknown",
    runtimeHealth:
      runtimeHealthy === true
        ? "healthy"
        : runtimeHealthy === false
          ? "unhealthy"
          : "unknown",
    message,
    nextAction,
    backend,
  };
  if (installedBackend !== true) {
    return capability("requiresSetup", {
      ...layers,
      code: "PLATFORM_BACKEND_SETUP_REQUIRED",
    });
  }
  if (runtimeHealthy !== true) {
    return capability("blocked", {
      ...layers,
      code: "PLATFORM_RUNTIME_HEALTH_BLOCKED",
    });
  }
  return capability("available", layers);
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
