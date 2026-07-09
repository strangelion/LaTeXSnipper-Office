import { BridgeClient } from "./bridge-client";

const bridge = new BridgeClient();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-selection-to-latexsnipper",
    title: "Send selected formula to LaTeXSnipper",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "insert-formula-here",
    title: "Insert formula here",
    contexts: ["editable"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "send-selection-to-latexsnipper") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() ?? "",
    });
    const latex = String(result.result ?? "").trim();
    if (!latex) return;

    await bridge.enqueue({
      actionType: "EditFormula",
      origin: "browser",
      target: "desktop",
      timeoutMs: 300_000,
      payload: {
        latex,
        display: latex.includes("\n"),
        source: "browser-selection",
        url: tab.url,
        title: tab.title,
      },
    });
  }
});

// Poll for incoming actions from desktop
setInterval(async () => {
  try {
    const data: any = await bridge.next("browser-default");
    if (!data?.found || !data.action?.actionId) return;

    const action = data.action;
    if (action.actionType === "InsertFormula" || action.actionType === "ReplaceSelection") {
      // Send to all tabs via content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, {
            type: "INSERT_FORMULA",
            payload: action.payload,
          });
          await bridge.complete(action.actionId, true, resp);
          return;
        } catch {
          // Try next tab
        }
      }
      // Fallback: copy to clipboard
      const latex = action.payload?.latex ?? "";
      const markdown = action.payload?.display ? `$$\n${latex}\n$$` : `$${latex}$`;
      await navigator.clipboard.writeText(markdown);
      await bridge.complete(action.actionId, true, { fallback: "clipboard" });
    }
  } catch {
    // Silent
  }
}, 1500);
