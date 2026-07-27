import { capability, unsupported } from "../capabilities.js";

export function obsidianCapabilities() {
  return {
    nativeOle: unsupported("Obsidian stores Markdown, not OLE objects."),
    ommlInsert: unsupported("Obsidian inserts LaTeX Markdown."),
    officeSelectionRead: unsupported("Obsidian is not an Office host."),
    screenshot: capability("available"),
  };
}
