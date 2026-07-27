import { capability, unsupported } from "../capabilities.js";

export function powerpointCapabilities({ os } = {}) {
  return {
    nativeOle:
      os === "windows"
        ? capability("available", {
            message: "Signed x86/x64 COM handler",
          })
        : unsupported("Native COM/OLE is Windows-only."),
    ommlInsert: unsupported(
      "PowerPoint formulas are inserted as slide shapes.",
    ),
    officeSelectionRead: capability("available", {
      message: "Selected slide-shape context",
    }),
  };
}
