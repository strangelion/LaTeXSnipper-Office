import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

function loadSource(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const contextSource = loadSource("../src/platform/platform-context.js");
const registrySource = loadSource("../src/platform/feature-registry.js");
const officeJsSource = loadSource("../src/platform/adapters/officejs.js");
const insertionSource = loadSource(
  "../src/services/office-insertion-service.js",
);
const { createPlatformContext } =
  await import("../src/platform/platform-context.js");
const { FeatureRegistry } = await import("../src/platform/feature-registry.js");

assert.match(contextSource, /schemaVersion: 1/);
assert.match(contextSource, /windowsCapabilities/);
assert.match(contextSource, /macosCapabilities/);
assert.match(contextSource, /linuxCapabilities/);
assert.match(contextSource, /wpsCapabilities/);
assert.match(registrySource, /resolve\(feature, platformContext\)/);
assert.match(registrySource, /PLATFORM_FEATURE_UNRESOLVED/);
assert.match(officeJsSource, /Office\.js never calls COM\/OLE/);
assert.match(
  insertionSource,
  /featureRegistry\.resolve\(feature, platformContext\)/,
);

const windowsDesktop = createPlatformContext({
  os: "windows",
  host: "desktop",
  architecture: "x64",
});
const windowsWord = createPlatformContext({
  os: "windows",
  host: "word",
  architecture: "x64",
});
const macWord = createPlatformContext({ os: "macos", host: "word" });
const officeJs = createPlatformContext({ os: "windows", host: "officejs" });
const wpsWriter = createPlatformContext({
  os: "windows",
  host: "wps-writer",
});
const wayland = createPlatformContext({
  os: "linux",
  host: "desktop",
  displayServer: "wayland",
});
const unknown = createPlatformContext({
  os: "freebsd",
  host: "desktop",
  displayServer: "wayland",
});
const healthyOle = createPlatformContext({
  os: "windows",
  host: "word",
  runtimeState: {
    nativeOle: {
      registered: true,
      currentDllMatches: true,
      available: true,
      bitnessMatch: true,
      geometryContract: true,
      inkIntegrity: true,
      handlerVersion: "1.6.0.0",
    },
  },
});
const staleOle = createPlatformContext({
  os: "windows",
  host: "word",
  runtimeState: {
    nativeOle: {
      registered: true,
      currentDllMatches: false,
      available: false,
      bitnessMatch: true,
      geometryContract: true,
      inkIntegrity: false,
    },
  },
});

assert.equal(windowsDesktop.features.nativeOle.level, "unsupported");
assert.equal(windowsDesktop.features.screenshotMultiMonitor.level, "available");
assert.equal(windowsWord.features.nativeOle.level, "requiresSetup");
assert.equal(macWord.features.nativeOle.level, "unsupported");
assert.equal(officeJs.features.nativeOle.level, "unsupported");
assert.equal(officeJs.features.officeJs.level, "available");
assert.equal(wpsWriter.features.nativeOle.level, "unsupported");
assert.equal(wpsWriter.features.ommlInsert.level, "experimental");
assert.equal(wayland.features.screenshotWaylandPortal.level, "experimental");
assert.equal(unknown.os, "unknown");
assert.equal(unknown.features.screenshot.level, "unsupported");
assert.equal(unknown.features.screenshotWaylandPortal.level, "unsupported");
assert.equal(unknown.features.cuda.level, "unsupported");
assert.equal(healthyOle.features.nativeOle.level, "available");
assert.equal(staleOle.features.nativeOle.level, "requiresSetup");

const registry = new FeatureRegistry();
registry.register("formula.insert", { execute: () => "fallback" }).register(
  "formula.insert",
  { execute: () => "word-native" },
  {
    priority: 10,
    matches: (context) => context.os === "windows" && context.host === "word",
  },
);
assert.equal(
  registry.resolve("formula.insert", windowsWord).execute(),
  "word-native",
);
assert.equal(registry.resolve("formula.insert", macWord).execute(), "fallback");
assert.throws(
  () => registry.resolve("missing.feature", windowsDesktop),
  /PLATFORM_FEATURE_UNRESOLVED/,
);

console.log("Platform capability registry contracts passed OK");
