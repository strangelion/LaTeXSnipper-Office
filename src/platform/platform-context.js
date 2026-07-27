import { mergeFeatureCapabilities } from "./capabilities.js";
import { windowsCapabilities } from "./adapters/windows.js";
import { macosCapabilities } from "./adapters/macos.js";
import { linuxCapabilities } from "./adapters/linux.js";
import { desktopCapabilities } from "./adapters/desktop.js";
import { wordCapabilities } from "./adapters/word.js";
import { excelCapabilities } from "./adapters/excel.js";
import { powerpointCapabilities } from "./adapters/powerpoint.js";
import { officeJsCapabilities } from "./adapters/officejs.js";
import { wpsCapabilities } from "./adapters/wps.js";
import { obsidianCapabilities } from "./adapters/obsidian.js";

const HOSTS = new Set([
  "desktop",
  "word",
  "excel",
  "powerpoint",
  "officejs",
  "wps-writer",
  "wps-spreadsheets",
  "wps-presentation",
  "obsidian",
  "browser",
]);

export function normalizeOs(value) {
  const os = String(value || "").toLowerCase();
  if (os.includes("win")) return "windows";
  if (os.includes("mac") || os.includes("darwin")) return "macos";
  return "linux";
}

export function normalizeHost(value) {
  const host = String(value || "desktop").toLowerCase();
  return HOSTS.has(host) ? host : "desktop";
}

export function detectBrowserOs() {
  return normalizeOs(
    globalThis.navigator?.userAgentData?.platform ||
      globalThis.navigator?.platform ||
      "linux",
  );
}

export function createPlatformContext(options = {}) {
  const os = normalizeOs(options.os || detectBrowserOs());
  const host = normalizeHost(options.host);
  const architecture = ["x86", "x64", "arm64"].includes(options.architecture)
    ? options.architecture
    : "unknown";
  const osPatch =
    os === "windows"
      ? windowsCapabilities()
      : os === "macos"
        ? macosCapabilities()
        : linuxCapabilities(options);
  const hostPatch =
    host === "desktop" || host === "browser"
      ? desktopCapabilities()
      : host === "word"
        ? wordCapabilities({ os })
        : host === "excel"
          ? excelCapabilities({ os })
          : host === "powerpoint"
            ? powerpointCapabilities({ os })
            : host === "officejs"
              ? officeJsCapabilities()
              : host.startsWith("wps-")
                ? wpsCapabilities(host)
                : host === "obsidian"
                  ? obsidianCapabilities()
                  : {};

  return Object.freeze({
    schemaVersion: 1,
    os,
    host,
    architecture,
    features: Object.freeze(mergeFeatureCapabilities(osPatch, hostPatch)),
  });
}
