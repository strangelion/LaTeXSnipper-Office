import {
  extractConversation,
  defaultQuestionAndAnswer,
} from "./conversation/extract";
import type {
  BrowserImportAction,
  FormulaImportPayload,
} from "./conversation/types";
import {
  extractFormulaCandidates,
  parseTexCandidates,
} from "./formulas/pipeline";
import { insertWithExplicitClipboardFallback } from "./insertion/insert";
import { providerFor } from "./providers/registry";
import { loadSettings } from "./settings/storage";
import type { ReadScopeMode } from "./settings/schema";

declare const __TARGET__: "chrome" | "firefox";
declare global {
  interface Window {
    __latexsnipperContentLoaded?: boolean;
  }
}

function action(
  actionType: BrowserImportAction["actionType"],
  payload: BrowserImportAction["payload"],
): BrowserImportAction {
  const provider = providerFor(new URL(location.href));
  return {
    schemaVersion: 1,
    actionType,
    origin: "browser",
    target: "desktop",
    source: {
      browser: __TARGET__,
      provider: provider.id,
      pageUrl: location.href,
      pageTitle: document.title,
    },
    payload,
  };
}

function selectionAction(): BrowserImportAction | null {
  const text = getSelection()?.toString() || "";
  if (!text.trim()) return null;
  const formulas = parseTexCandidates(text.slice(0, 50_000), {
    pageUrl: location.href,
    maxFormulas: 100,
  });
  const payload: FormulaImportPayload = {
    schemaVersion: 1,
    formulas: formulas.length
      ? formulas
      : [
          {
            id: `selection-${Date.now()}`,
            rawSource: text.slice(0, 50_000),
            normalizedLatex: text.trim(),
            displayMode: text.includes("\n") ? "display" : "inline",
            source: "selection",
            renderer: "plain-text",
            confidence: 0.5,
            pageUrl: location.href,
          },
        ],
    scope: {
      mode: "selection-only",
      roles: ["user", "assistant"],
      messageIds: [],
      explicitUserConfirmation: true,
    },
    truncated: text.length > 50_000,
  };
  return action("ImportWebFormula", payload);
}

if (!window.__latexsnipperContentLoaded) {
  window.__latexsnipperContentLoaded = true;
  chrome.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse) => {
      const message = raw as {
        type?: string;
        mode?: ReadScopeMode;
        selectedIds?: string[];
        payload?: Parameters<typeof insertWithExplicitClipboardFallback>[0];
      };
      (async () => {
        if (message.type === "PING_CONTENT") {
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "SCAN_SELECTION") {
          const value = selectionAction();
          sendResponse({ ok: !!value, action: value });
          return;
        }
        if (message.type === "SCAN_PAGE_FORMULAS") {
          const settings = await loadSettings();
          const formulas = extractFormulaCandidates(document, {
            pageUrl: location.href,
            maxFormulas: settings.limits.maxFormulas,
            confidenceThreshold: settings.formulaConfidence,
          });
          sendResponse({
            ok: true,
            action: action("ImportWebFormula", {
              schemaVersion: 1,
              formulas,
              scope: {
                mode: "formula-only",
                roles: settings.roles,
                messageIds: [],
                explicitUserConfirmation: true,
              },
              truncated: formulas.length >= settings.limits.maxFormulas,
            }),
          });
          return;
        }
        if (message.type === "SCAN_CONVERSATION") {
          const settings = await loadSettings();
          let documentAst = extractConversation(
            document,
            settings,
            message.mode || "current-assistant-message",
            message.selectedIds || [],
          );
          if (!message.mode || message.mode === "current-assistant-message")
            documentAst = defaultQuestionAndAnswer(documentAst);
          documentAst.scope.explicitUserConfirmation = true;
          sendResponse({
            ok: true,
            action: action("ImportConversationSelection", documentAst),
          });
          return;
        }
        if (message.type === "INSERT_FORMULA" && message.payload) {
          sendResponse(
            await insertWithExplicitClipboardFallback(message.payload),
          );
          return;
        }
        sendResponse({ ok: false, error: "UNSUPPORTED_CONTENT_MESSAGE" });
      })().catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return true;
    },
  );
}
