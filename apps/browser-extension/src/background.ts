const BRIDGE_URL = "http://127.0.0.1:19876";

interface FormulaActionPayload {
  latex?: string;
  display?: boolean;
  [key: string]: unknown;
}

interface EcosystemAction {
  actionId: string;
  actionType: string;
  payload?: FormulaActionPayload;
}

interface NextActionResponse {
  found: boolean;
  action?: EcosystemAction;
}

class BridgeClient {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`Bridge error: ${response.status}`);
    return response.json() as Promise<T>;
  }

  enqueue(action: unknown): Promise<unknown> {
    return this.request<unknown>("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action),
    });
  }

  next(clientId: string): Promise<NextActionResponse> {
    return this.request<NextActionResponse>(`/api/ecosystem/actions/next?clientId=${encodeURIComponent(clientId)}&target=browser`);
  }

  complete(actionId: string, ok: boolean, result?: unknown, error?: unknown): Promise<unknown> {
    return this.request<unknown>("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: "browser-default", ok, result, error }),
    });
  }
}

const bridge = new BridgeClient();
const POLL_ALARM = "latexsnipper-poll-actions";
const POLL_PERIOD_MINUTES = 0.5;

interface InsertResponse {
  ok?: boolean;
  fallback?: string | null;
  error?: string;
}

let pollInProgress = false;

function ensurePollingAlarm(): void {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "send-selection-to-latexsnipper",
      title: "Send selected formula to LaTeXSnipper",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "insert-formula-here",
      title: "Insert queued formula here",
      contexts: ["editable"],
    });
  });
  ensurePollingAlarm();
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
    return;
  }

  if (info.menuItemId === "insert-formula-here") {
    await pollForActions(tab.id);
  }
});

async function pollForActions(preferredTabId?: number): Promise<void> {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const data = await bridge.next("browser-default");
    if (!data?.found || !data.action?.actionId) return;

    const action = data.action;
    if (action.actionType === "InsertFormula" || action.actionType === "ReplaceSelection") {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabIds = [preferredTabId, ...tabs.map((tab) => tab.id)]
        .filter((tabId): tabId is number => typeof tabId === "number")
        .filter((tabId, index, all) => all.indexOf(tabId) === index);

      for (const tabId of tabIds) {
        try {
          const response: unknown = await chrome.tabs.sendMessage(tabId, {
            type: "INSERT_FORMULA",
            payload: action.payload,
          });
          const result = response && typeof response === "object" ? response as InsertResponse : {};
          if (result.ok) {
            await bridge.complete(action.actionId, true, result);
            return;
          }
        } catch (error) {
          console.debug("LaTeXSnipper could not insert into a candidate tab", error);
        }
      }

      await bridge.complete(action.actionId, false, undefined, {
        code: "NO_EDITABLE_BROWSER_TARGET",
        message: "No editable page accepted the formula and clipboard fallback failed.",
      });
    }
  } catch (error) {
    console.debug("LaTeXSnipper browser action poll failed", error);
  } finally {
    pollInProgress = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    void pollForActions();
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensurePollingAlarm();
  void pollForActions();
});
