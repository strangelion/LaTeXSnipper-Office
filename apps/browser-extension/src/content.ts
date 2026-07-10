import { extractFormulasFromDocument, extractLatexFromText } from "./formula-detector";
import { insertTextAtCursor } from "./insert-text";

interface ExtensionMessage {
  type?: string;
  payload?: {
    latex?: string;
    display?: boolean;
  };
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const message = rawMessage && typeof rawMessage === "object" ? rawMessage as ExtensionMessage : {};
  (async () => {
    if (message.type === "SCAN_SELECTION") {
      const text = window.getSelection()?.toString() ?? "";
      sendResponse({ ok: true, text, formulas: extractLatexFromText(text) });
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
      if (insertTextAtCursor(markdown)) {
        sendResponse({ ok: true, fallback: null });
        return;
      }

      try {
        await navigator.clipboard.writeText(markdown);
        sendResponse({ ok: true, fallback: "clipboard" });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unsupported extension message" });
  })();
  return true;
});
