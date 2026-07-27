import { capability, unsupported } from "../capabilities.js";

export function officeJsCapabilities() {
  return {
    nativeOle: unsupported("Office.js never calls COM/OLE."),
    namedPipe: unsupported("Office.js uses the authenticated HTTPS Bridge."),
    officeJs: capability("available"),
    ommlInsert: capability("available", {
      message: "Word OOXML/OMML; other hosts use text or image fallback.",
    }),
    officeSelectionRead: capability("experimental"),
  };
}
