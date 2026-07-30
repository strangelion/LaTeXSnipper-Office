import { unsupported } from "../capabilities.js";

export function unknownCapabilities() {
  return {
    nativeOle: unsupported("Unknown operating systems fail closed."),
    screenshot: unsupported(
      "Screenshot backend cannot be selected for an unknown operating system.",
    ),
    screenshotMultiMonitor: unsupported(
      "Multi-monitor capture requires a known operating system backend.",
    ),
    screenshotWaylandPortal: unsupported(
      "Unknown operating systems are not treated as Wayland.",
    ),
    directMl: unsupported("Unknown operating systems are not Windows."),
    coreMl: unsupported("Unknown operating systems are not macOS."),
    cuda: unsupported("CUDA is not inferred for an unknown operating system."),
    namedPipe: unsupported("Named-pipe support is not inferred."),
    globalShortcut: unsupported("Global shortcut support is not inferred."),
    secureCredentialStore: unsupported(
      "No platform credential store is inferred.",
    ),
  };
}
