import { BridgeClient } from "./bridge/client";
import type { BrowserImportAction } from "./conversation/types";
import { t } from "./i18n";

declare const __TARGET__: "chrome" | "firefox";
const VERSION = chrome.runtime.getManifest().version;
const HEARTBEAT_ALARM = "latexsnipper-browser-heartbeat";
const ACTION_ALARM = "latexsnipper-browser-actions";
let activeUiCount = 0;
let backoffUntil = 0;
let bridgePromise: Promise<BridgeClient> | null = null;

async function bridge(): Promise<BridgeClient> {
  if (!bridgePromise) bridgePromise = (async () => {
    const stored = await chrome.storage.local.get("browserClientId");
    const clientId = typeof stored.browserClientId === "string" ? stored.browserClientId : `browser-${crypto.randomUUID()}`;
    if (!stored.browserClientId) await chrome.storage.local.set({ browserClientId: clientId });
    return new BridgeClient(clientId, __TARGET__);
  })();
  return bridgePromise;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try { await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" }); }
  catch { await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }); }
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("UNSUPPORTED_TAB");
  await ensureContentScript(tab.id);
  return tab;
}

async function enqueueImport(action: BrowserImportAction): Promise<unknown> {
  if (action.origin !== "browser" || action.target !== "desktop") throw new Error("INVALID_ACTION_DIRECTION");
  if (!['ImportWebFormula', 'ImportConversationSelection'].includes(action.actionType)) throw new Error("INVALID_IMPORT_ACTION");
  return (await bridge()).enqueue({ ...action, timeoutMs: 300_000 });
}

async function pollDesktopActions(preferredTabId?: number): Promise<void> {
  if (Date.now() < backoffUntil || activeUiCount === 0) return;
  try {
    const client = await bridge();
    const next = await client.next();
    if (!next.found || !next.action) return;
    const action = next.action;
    if (!['InsertFormulaIntoBrowser', 'ReplaceBrowserSelection'].includes(action.actionType)) {
      await client.complete(action.actionId, false, undefined, { code: "UNSUPPORTED_BROWSER_ACTION", message: "Only versioned desktop-to-browser insertion actions are accepted." });
      return;
    }
    const tab = preferredTabId ? await chrome.tabs.get(preferredTabId) : await activeTab();
    if (!tab.id) throw new Error("NO_ACTIVE_TAB");
    await ensureContentScript(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { type: "INSERT_FORMULA", payload: action.payload });
    await client.complete(action.actionId, !!result?.ok, result, result?.ok ? undefined : { code: result?.errorCode || "BROWSER_INSERT_FAILED", message: result?.message || "Browser editor rejected insertion." });
  } catch {
    backoffUntil = Date.now() + 15_000;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "send-selection", title: t("sendSelection"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: "insert-formula", title: t("openPanel"), contexts: ["editable"] });
  });
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.25 });
  chrome.alarms.create(ACTION_ALARM, { periodInMinutes: 0.5 });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "insert-formula") { activeUiCount = Math.max(1, activeUiCount); await pollDesktopActions(tab.id); return; }
  if (info.menuItemId === "send-selection") {
    await ensureContentScript(tab.id);
    const scan = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SELECTION" });
    if (!scan?.action) return;
    await enqueueImport(scan.action);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as { type?: string; action?: BrowserImportAction; tabId?: number };
  (async () => {
    if (request.type === "UI_ACTIVE") { activeUiCount += 1; const client = await bridge(); await client.register(VERSION); sendResponse({ ok: true }); return; }
    if (request.type === "UI_INACTIVE") { activeUiCount = Math.max(0, activeUiCount - 1); sendResponse({ ok: true }); return; }
    if (request.type === "BRIDGE_PING") { try { await (await bridge()).ping(); sendResponse({ ok: true }); } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }); } return; }
    if (request.type === "GET_ACTIVE_TAB") { try { const tab = await activeTab(); sendResponse({ ok: true, tabId: tab.id, url: tab.url, title: tab.title }); } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }); } return; }
    if (request.type === "SEND_IMPORT" && request.action) { await enqueueImport(request.action); sendResponse({ ok: true }); return; }
    sendResponse({ ok: false, error: "UNSUPPORTED_BACKGROUND_MESSAGE" });
  })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM && activeUiCount > 0 && Date.now() >= backoffUntil) void bridge().then((client) => client.heartbeat()).catch(() => { backoffUntil = Date.now() + 15_000; });
  if (alarm.name === ACTION_ALARM) void pollDesktopActions();
});
