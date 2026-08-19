import { Notice, Plugin } from "obsidian";
import { BridgeClient } from "./bridge-client";
import type { ObsidianAdapter } from "../obsidian.adapter";
import { insertPngAttachment } from "./image-attachment";

export function startActionPoller(
  bridge: BridgeClient,
  adapter: ObsidianAdapter,
  plugin: Plugin,
) {
  let running = false;

  const tick = async () => {
    if (running) return;

    running = true;
    let actionId: string | null = null;

    try {
      const data: any = await bridge.next("obsidian");

      if (!data?.found || !data.action?.actionId) return;

      const action = data.action;
      actionId = action.actionId;

      let result: any;

      if (action.actionType === "InsertFormula") {
        const payload = action.payload || {};

        const mode =
          payload.mode === "numbered"
            ? "numbered"
            : payload.mode === "block" ||
                payload.mode === "display" ||
                payload.display === true
              ? "block"
              : "inline";

        result = await adapter.execute({
          type: "InsertFormula",
          payload: {
            latex: payload.latex || "",
            display: mode,
            formulaId: payload.formulaId,
          },
        } as any);
      } else if (action.actionType === "InsertImage") {
        const payload = action.payload || {};
        const inserted = await insertPngAttachment(
          plugin,
          payload.pngBase64 || "",
          payload.fileName,
          payload.altText,
        );
        result = { ok: true, data: inserted };
      } else if (action.actionType === "ReplaceSelection") {
        const payload = action.payload || {};

        result = await adapter.execute({
          type: "ReplaceSelection",
          payload: {
            content: payload.content ?? payload.markdown ?? payload.latex ?? "",
          },
        } as any);
      } else {
        result = {
          ok: false,
          error: `Unsupported ecosystem action: ${action.actionType}`,
        };
      }

      await bridge.complete(
        actionId,
        result.ok === true,
        result.ok
          ? {
              inserted: true,
              data: result.data ?? null,
            }
          : null,
        result.ok
          ? undefined
          : {
              code: "OBSIDIAN_ACTION_FAILED",
              message: result.error || "Obsidian rejected the action.",
            },
      );

      if (!result.ok) {
        new Notice(`LaTeXSnipper：${result.error || "插入失败"}`);
      }
    } catch (error) {
      if (actionId) {
        await bridge
          .complete(actionId, false, null, {
            code: "OBSIDIAN_POLLER_ERROR",
            message: error instanceof Error ? error.message : String(error),
          })
          .catch(() => {});
      }

      console.error("[LaTeXSnipper] Obsidian ecosystem action failed", error);
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => void tick(), 1500);

  return () => window.clearInterval(timer);
}
