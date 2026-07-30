import { capability, unsupported } from "../capabilities.js";
import { nativeOleCapability } from "./native-ole.js";

export function excelCapabilities({ os, runtimeState } = {}) {
  return {
    nativeOle: nativeOleCapability({ os, runtimeState }),
    ommlInsert: unsupported("Excel formulas are inserted as anchored shapes."),
    officeSelectionRead: capability("available", {
      message: "Cell range and selected-shape context",
    }),
  };
}
