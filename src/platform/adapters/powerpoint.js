import { capability, unsupported } from "../capabilities.js";
import { nativeOleCapability } from "./native-ole.js";

export function powerpointCapabilities({ os, runtimeState } = {}) {
  return {
    nativeOle: nativeOleCapability({ os, runtimeState }),
    ommlInsert: unsupported(
      "PowerPoint formulas are inserted as slide shapes.",
    ),
    officeSelectionRead: capability("available", {
      message: "Selected slide-shape context",
    }),
  };
}
