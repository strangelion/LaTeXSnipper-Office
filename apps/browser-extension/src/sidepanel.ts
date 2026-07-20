import type { BrowserImportAction } from "./conversation/types";
import { localizeDocument, t } from "./i18n";
const items = document.getElementById("items")!;
let tabId: number | undefined;
async function bg(message: unknown): Promise<any> {
  return chrome.runtime.sendMessage(message);
}
async function load(message: unknown): Promise<void> {
  if (!tabId) return;
  const response = (await chrome.tabs.sendMessage(tabId, message)) as {
    ok: boolean;
    action?: BrowserImportAction;
    error?: string;
  };
  if (!response.ok || !response.action) throw new Error(response.error);
  items.replaceChildren();
  const action = response.action;
  const payload = action.payload;
  const rows =
    "messages" in payload
      ? payload.messages.map(
          (message) =>
            `${message.sequence + 1}. ${message.role} · ${message.blocks.length} blocks`,
        )
      : payload.formulas.map(
          (formula) =>
            `${formula.displayMode} · ${(formula.normalizedLatex || formula.rawSource).slice(0, 100)}`,
        );
  for (const text of rows) {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = text;
    items.append(card);
  }
  const confirm = document.createElement("button");
  confirm.textContent = t("sendSelection");
  confirm.addEventListener("click", async () => {
    await bg({ type: "SEND_IMPORT", action });
    confirm.disabled = true;
    confirm.textContent = t("sentToDesktop");
  });
  items.append(confirm);
}
document.getElementById("current")!.addEventListener(
  "click",
  () =>
    void load({
      type: "SCAN_CONVERSATION",
      mode: "current-assistant-message",
    }),
);
document
  .getElementById("conversation")!
  .addEventListener(
    "click",
    () => void load({ type: "SCAN_CONVERSATION", mode: "loaded-conversation" }),
  );
document
  .getElementById("formulas")!
  .addEventListener("click", () => void load({ type: "SCAN_PAGE_FORMULAS" }));
document
  .getElementById("clear")!
  .addEventListener("click", () => items.replaceChildren());
(async () => {
  localizeDocument();
  await bg({ type: "UI_ACTIVE" });
  tabId = (await bg({ type: "GET_ACTIVE_TAB" })).tabId;
})();
addEventListener("unload", () => {
  void bg({ type: "UI_INACTIVE" });
  items.replaceChildren();
});
