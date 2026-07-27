import { capability, unsupported } from "../capabilities.js";

export function wpsCapabilities(host) {
  const writer = host === "wps-writer";
  return {
    nativeOle: unsupported("WPS JSAddIn does not expose the Native OLE route."),
    ommlInsert: writer
      ? capability("experimental")
      : unsupported("WPS spreadsheet/presentation use shape insertion."),
    officeSelectionRead: writer
      ? capability("experimental")
      : unsupported("This WPS host lifecycle is not implemented."),
  };
}
