import * as vscode from "vscode";
import { BridgeClient } from "./bridge-client";
import { insertText } from "./editor-adapter";

export function startActionPoller(
  bridge: BridgeClient,
  statusBar: vscode.StatusBarItem,
) {
  let running = false;

  const tick = async () => {
    if (running) return;

    running = true;
    let actionId: string | null = null;

    try {
      const data: any = await bridge.next();

      if (!data?.found || !data.action?.actionId) return;

      const action = data.action;
      actionId = action.actionId;

      const latex = action.payload?.latex ?? "";
      const display = !!action.payload?.display;
      const markdown =
        action.payload?.markdown ??
        (display ? `$$\n${latex}\n$$` : `$${latex}$`);

      await insertText(markdown);

      await bridge.complete(actionId, true, {
        inserted: true,
      });

      statusBar.text = "$(check) LaTeXSnipper: formula inserted";
      setTimeout(() => {
        statusBar.text = "$(symbol-event) LaTeXSnipper";
      }, 3000);
    } catch (error) {
      if (actionId) {
        await bridge
          .complete(actionId, false, null, {
            code: "VSCODE_ACTION_FAILED",
            message:
              error instanceof Error
                ? error.message
                : String(error),
          })
          .catch(() => {});
      }

      console.error(
        "[LaTeXSnipper] VS Code ecosystem action failed",
        error,
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), 1500);

  return () => clearInterval(timer);
}
