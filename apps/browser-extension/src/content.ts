import { extractFormulasFromDocument, extractLatexFromText } from "./formula-detector";
import { insertTextAtCursor } from "./insert-text";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "SCAN_SELECTION") {
      const text = window.getSelection()?.toString() ?? "";
      sendResponse({ ok: true, formulas: extractLatexFromText(text) });
      return;
    }
    if (message.type === "SCAN_PAGE") {
      sendResponse({ ok: true, formulas: extractFormulasFromDocument(document) });
      return;
    }
    if (message.type === "INSERT_FORMULA") {
      const latex = message.payload?.latex ?? "";
      const display = !!message.payload?.display;
      const markdown = display ? `$$\n${latex}\n$$` : `$${latex}$`;
      const ok = insertTextAtCursor(markdown);
      sendResponse({ ok, fallback: ok ? null : "clipboard" });
      return;
    }
  })();
  return true;
});
