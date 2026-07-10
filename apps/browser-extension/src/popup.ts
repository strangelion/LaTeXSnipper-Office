import type { FormulaCandidate } from "./formula-detector";

const BRIDGE_URL = "http://127.0.0.1:19876";

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

  async ping(): Promise<boolean> {
    try {
      await this.request<unknown>("/api/ecosystem/ping");
      return true;
    } catch {
      return false;
    }
  }

  enqueue(action: unknown): Promise<unknown> {
    return this.request<unknown>("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action),
    });
  }
}

interface ScanResponse {
  ok?: boolean;
  text?: string;
  formulas?: FormulaCandidate[];
}

(() => {
  const bridge = new BridgeClient();
  const statusEl = document.getElementById("status")!;
  const formulasEl = document.getElementById("formulas")!;

  function setStatus(message: string, connected: boolean): void {
    statusEl.textContent = message;
    statusEl.className = connected ? "status connected" : "status disconnected";
  }

  async function checkConnection(): Promise<void> {
    if (await bridge.ping()) {
      setStatus("Connected to LaTeXSnipper", true);
    } else {
      statusEl.textContent = "Desktop app not running";
      statusEl.className = "status disconnected";
    }
  }

  function renderFormulas(formulas: FormulaCandidate[]): void {
    formulasEl.replaceChildren();
    if (formulas.length === 0) {
      const empty = document.createElement("div");
      empty.className = "formula-item";
      empty.textContent = "No formulas found on this page.";
      formulasEl.append(empty);
      return;
    }

    for (const formula of formulas.slice(0, 20)) {
      const item = document.createElement("div");
      item.className = "formula-item";
      const delimiter = formula.display ? "$$" : "$";
      item.textContent = `${delimiter}${formula.latex.substring(0, 80)}${delimiter}`;
      formulasEl.append(item);
    }
  }

  document.getElementById("scanPage")!.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const response: unknown = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
      const scan = response && typeof response === "object" ? response as ScanResponse : {};
      renderFormulas(scan.formulas ?? []);
    } catch {
      formulasEl.replaceChildren();
      const error = document.createElement("div");
      error.className = "formula-item";
      error.textContent = "Cannot scan this page.";
      formulasEl.append(error);
    }
  });

  document.getElementById("sendSelection")!.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const response: unknown = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SELECTION" });
      const scan = response && typeof response === "object" ? response as ScanResponse : {};
      const selectedFormula = scan.formulas?.[0];
      const latex = selectedFormula?.latex ?? scan.text?.trim() ?? "";
      if (!latex) {
        setStatus("No selected formula found", false);
        return;
      }

      await bridge.enqueue({
        actionType: "EditFormula",
        origin: "browser",
        target: "desktop",
        timeoutMs: 300_000,
        payload: {
          latex,
          display: selectedFormula?.display ?? latex.includes("\n"),
          source: "browser-selection",
          url: tab.url,
          title: tab.title,
        },
      });
      setStatus("Selection sent to LaTeXSnipper", true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cannot send selection", false);
    }
  });

  void checkConnection();
})();
