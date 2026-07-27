import { capability, unsupported } from "../capabilities.js";

export function wordCapabilities({ os } = {}) {
  return {
    nativeOle:
      os === "windows"
        ? capability("available", {
            message: "Signed x86/x64 COM handler",
          })
        : unsupported("Native COM/OLE is Windows-only."),
    ommlInsert: capability("available"),
    officeSelectionRead: capability("available"),
  };
}
