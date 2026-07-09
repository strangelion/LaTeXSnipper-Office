import { MarkdownView, Plugin } from "obsidian";
import { BridgeClient } from "./bridge-client";
import { startActionPoller } from "./action-poller";

export function getActiveEditor(plugin: Plugin) {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  return view?.editor ?? null;
}

export function insertMarkdownFormula(plugin: Plugin, latex: string, display: boolean): boolean {
  const editor = getActiveEditor(plugin);
  if (!editor) return false;
  const text = display ? `$$\n${latex}\n$$` : `$${latex}$`;
  editor.replaceSelection(text);
  return true;
}

export function getSelectionLatex(plugin: Plugin): string {
  const editor = getActiveEditor(plugin);
  return editor?.getSelection() ?? "";
}

export function setupEcosystemBridge(plugin: Plugin) {
  const bridge = new BridgeClient(plugin);

  // Register client and start heartbeat
  bridge.register("obsidian-default", "Obsidian").catch(() => {});
  const heartbeatTimer = setInterval(() => {
    bridge.heartbeat("obsidian-default").catch(() => {});
  }, 10000);

  // Start action poller
  const stopPoller = startActionPoller(plugin, bridge);

  // Cleanup on unload
  plugin.register(() => {
    clearInterval(heartbeatTimer);
    stopPoller();
  });
}
