import { capability, unsupported } from "../capabilities.js";

export function linuxCapabilities({ displayServer = "unknown" } = {}) {
  return {
    nativeOle: unsupported("COM/OLE is not available on Linux."),
    screenshot: capability("available", {
      backend: "xcap",
      message:
        displayServer === "wayland"
          ? "backend=xcap/libwayshot (Wayland)"
          : "backend=xcap (X11)",
    }),
    screenshotWaylandPortal:
      displayServer === "wayland"
        ? capability("experimental", {
            backend: "xcap/libwayshot",
            message: "Portal availability must still be proven by capture.",
          })
        : unsupported("Wayland portal is only used in a Wayland session."),
    cuda: capability("requiresSetup", {
      code: "CUDA_CORE_VALIDATION_REQUIRED",
      message: "CUDA installation hints do not prove provider readiness.",
      nextAction: "Run the Core provider probe.",
    }),
    globalShortcut: capability("experimental"),
    secureCredentialStore: capability("requiresSetup", {
      message: "Secret Service must be available.",
    }),
  };
}
