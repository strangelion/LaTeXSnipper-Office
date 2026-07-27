import { capability } from "../capabilities.js";

export function windowsCapabilities() {
  return {
    screenshot: capability("available"),
    screenshotMultiMonitor: capability("available"),
    directMl: capability("requiresSetup", {
      code: "DIRECTML_CORE_VALIDATION_REQUIRED",
      message:
        "Windows supports DirectML, but Core must validate the provider.",
      nextAction: "Run the Core provider probe.",
    }),
    namedPipe: capability("available"),
    globalShortcut: capability("available"),
    secureCredentialStore: capability("available", {
      message: "DPAPI/Credential Manager",
    }),
  };
}
