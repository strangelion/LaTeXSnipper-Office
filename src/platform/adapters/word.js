import { capability } from "../capabilities.js";
import { nativeOleCapability } from "./native-ole.js";

export function wordCapabilities({ os, runtimeState } = {}) {
  return {
    nativeOle: nativeOleCapability({ os, runtimeState }),
    ommlInsert: capability("available"),
    officeSelectionRead: capability("available"),
  };
}
