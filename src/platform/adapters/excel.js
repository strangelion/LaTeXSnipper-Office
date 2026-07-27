import { capability, unsupported } from "../capabilities.js";

export function excelCapabilities({ os } = {}) {
  return {
    nativeOle:
      os === "windows"
        ? capability("available", {
            message: "Signed x86/x64 COM handler",
          })
        : unsupported("Native COM/OLE is Windows-only."),
    ommlInsert: unsupported("Excel formulas are inserted as anchored shapes."),
    officeSelectionRead: capability("available", {
      message: "Cell range and selected-shape context",
    }),
  };
}
