import { MarkdownView, Plugin } from "obsidian";
import { BridgeClient } from "./bridge-client";
import { startActionPoller } from "./action-poller";
import type { ObsidianAdapter } from "../obsidian.adapter";

export function getActiveEditor(plugin: Plugin) {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  return view?.editor ?? null;
}

export function insertMarkdownFormula(
  plugin: Plugin,
  latex: string,
  display: boolean,
): boolean {
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
  const clientName = `Obsidian · ${plugin.app.vault.getName()}`;

  // Register initially, then auto-re-register if heartbeat shows not registered
  bridge.register(clientName).catch((error) => {
    console.error("[LaTeXSnipper] Ecosystem registration failed:", error);
  });

  const heartbeatTimer = setInterval(async () => {
    try {
      const result: any = await bridge.heartbeat();
      if (result?.registered === false) {
        // Desktop restarted or client was lost, re-register
        await bridge.register(clientName).catch((error) => {
          console.error(
            "[LaTeXSnipper] Ecosystem re-registration failed:",
            error,
          );
        });
      }
    } catch (error) {
      console.warn("[LaTeXSnipper] Bridge heartbeat failed:", error);
    }
  }, 10000);

  const stopPoller = startActionPoller(bridge, adapter);

  plugin.register(() => {
    clearInterval(heartbeatTimer);
    stopPoller();
  });
}
