import { MarkdownView, Plugin } from "obsidian";
import { BridgeClient } from "./bridge-client";
import { startActionPoller } from "./action-poller";
import type { ObsidianAdapter } from "../obsidian.adapter";

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

export function setupEcosystemBridge(
  plugin: Plugin,
  adapter: ObsidianAdapter,
  clientId: string,
) {
  const bridge = new BridgeClient(plugin, clientId);

  bridge
    .register(
      `Obsidian · ${plugin.app.vault.getName()}`,
    )
    .catch(() => {});

  const heartbeatTimer = setInterval(() => {
    bridge.heartbeat().catch(() => {});
  }, 10000);

  const stopPoller =
    startActionPoller(bridge, adapter);

  plugin.register(() => {
    clearInterval(heartbeatTimer);
    stopPoller();
  });
}
