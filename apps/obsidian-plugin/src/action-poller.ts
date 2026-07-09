import { Plugin, Notice } from "obsidian";
import { BridgeClient } from "./bridge-client";
import { insertMarkdownFormula } from "./editor-adapter";

export function startActionPoller(plugin: Plugin, bridge: BridgeClient) {
  const timer = window.setInterval(async () => {
    try {
      const data: any = await bridge.next("obsidian-default", "obsidian");
      if (!data?.found || !data.action?.actionId) return;

      const action = data.action;
      if (action.actionType === "InsertFormula" || action.actionType === "ReplaceSelection") {
        const latex = action.payload?.latex ?? "";
        const display = !!action.payload?.display;
        const ok = insertMarkdownFormula(plugin, latex, display);

        await bridge.complete(
          action.actionId,
          ok,
          ok ? { inserted: true } : null,
          ok ? undefined : { code: "NO_ACTIVE_MARKDOWN_EDITOR", message: "No active Markdown editor." }
        );

        if (!ok) new Notice("No active Markdown editor.");
      }
    } catch {
      // Silent
    }
  }, 1500);

  return () => window.clearInterval(timer);
}
