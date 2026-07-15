import type { BrowserImportAction } from "./conversation/types";
import { localizeDocument, t } from "./i18n";

interface BackgroundResponse { ok?: boolean; tabId?: number; action?: BrowserImportAction; error?: string; }
const status = document.getElementById("status")!;
const results = document.getElementById("results")!;
let tabId: number | undefined;

function setStatus(message: string, connected = false): void { status.textContent = message; status.className = connected ? "status connected" : "status disconnected"; }
async function background(message: unknown): Promise<BackgroundResponse> { return chrome.runtime.sendMessage(message) as Promise<BackgroundResponse>; }
async function scan(message: unknown): Promise<void> {
  if (!tabId) throw new Error("NO_ACTIVE_TAB");
  const response = await chrome.tabs.sendMessage(tabId, message) as BackgroundResponse;
  if (!response.ok || !response.action) throw new Error(response.error || "SCAN_FAILED");
  results.replaceChildren();
  const payload = response.action.payload;
  const formulaCount = "formulas" in payload ? payload.formulas.length : payload.messages.reduce((total, item) => total + item.blocks.filter((block) => block.type === "formula").length, 0);
  const messageCount = "messages" in payload ? payload.messages.length : 0;
  const preview = document.createElement("div"); preview.className = "result"; preview.textContent = `${t("messagesCount", String(messageCount))} · ${t("formulasCount", String(formulaCount))}`;
  const confirm = document.createElement("button"); confirm.textContent = t("sendSelection");
  confirm.addEventListener("click", async () => { const sent = await background({ type: "SEND_IMPORT", action: response.action }); if (!sent.ok) throw new Error(sent.error); setStatus(t("sentToDesktop"), true); confirm.disabled = true; });
  results.append(preview, confirm);
}

document.getElementById("scanSelection")!.addEventListener("click", () => void scan({ type: "SCAN_SELECTION" }).catch(() => setStatus(t("noSelection"))));
document.getElementById("scanMessage")!.addEventListener("click", () => void scan({ type: "SCAN_CONVERSATION", mode: "current-assistant-message" }).catch(() => setStatus(t("scanFailed"))));
document.getElementById("scanPage")!.addEventListener("click", () => void scan({ type: "SCAN_PAGE_FORMULAS" }).catch(() => setStatus(t("scanFailed"))));
document.getElementById("openPanel")!.addEventListener("click", async () => {
  if (chrome.sidePanel && tabId) await chrome.sidePanel.open({ tabId });
  else await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  window.close();
});

(async () => {
  localizeDocument();
  await background({ type: "UI_ACTIVE" });
  const tab = await background({ type: "GET_ACTIVE_TAB" }); tabId = tab.tabId;
  const bridge = await background({ type: "BRIDGE_PING" }); setStatus(bridge.ok ? t("connected") : t("desktopOffline"), !!bridge.ok);
})().catch(() => setStatus(t("desktopOffline")));
window.addEventListener("unload", () => { void background({ type: "UI_INACTIVE" }); });
