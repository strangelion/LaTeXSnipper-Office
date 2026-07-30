import { capability, unsupported } from "../capabilities.js";

export function desktopCapabilities({ os } = {}) {
  return {
    ...(os === "unknown"
      ? {
          screenshot: unsupported(
            "Unknown OS has no selected capture backend.",
          ),
          screenshotMultiMonitor: unsupported(
            "Unknown OS has no selected multi-monitor backend.",
          ),
          globalShortcut: unsupported(
            "Unknown OS has no selected shortcut backend.",
          ),
        }
      : { globalShortcut: capability("available") }),
  };
}
