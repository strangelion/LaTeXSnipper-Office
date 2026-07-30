import { capability } from "../capabilities.js";

export function windowsCapabilities() {
  return {
    screenshot: capability("available", {
      backend: "xcap",
      message: "xcap Windows capture backend",
    }),
    screenshotMultiMonitor: capability("available", { backend: "xcap" }),
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
