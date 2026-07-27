import { capability } from "../capabilities.js";

export function desktopCapabilities() {
  return {
    screenshot: capability("available"),
    screenshotMultiMonitor: capability("available"),
    globalShortcut: capability("available"),
  };
}
