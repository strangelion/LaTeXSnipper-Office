import { capability, unsupported } from "../capabilities.js";

export function macosCapabilities() {
  return {
    nativeOle: unsupported("Native COM/OLE is Windows-only."),
    coreMl: capability("requiresSetup", {
      code: "COREML_CORE_VALIDATION_REQUIRED",
      message: "CoreML availability is reported only after Core validation.",
      nextAction: "Run the Core provider probe.",
    }),
    officeJs: capability("available"),
    screenshot: capability("experimental", {
      backend: "xcap",
      code: "MACOS_XCAP_EXPERIMENTAL",
      message:
        "backend=xcap; no independent ScreenCaptureKit adapter is implemented.",
      nextAction:
        "Grant Screen Recording permission and verify a test capture.",
    }),
    globalShortcut: capability("available"),
    secureCredentialStore: capability("available", {
      message: "macOS Keychain",
    }),
  };
}
