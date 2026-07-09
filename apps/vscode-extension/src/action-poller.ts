import { BridgeClient } from "./bridge-client";
import { insertText } from "./editor-adapter";

export function startActionPoller(bridge: BridgeClient, statusBar: vscode.StatusBarItem) {
  const timer = setInterval(async () => {
    try {
      const data: any = await bridge.next("vscode-default");
      if (!data?.found || !data.action?.actionId) return;

      const action = data.action;
      if (action.actionType === "InsertFormula" || action.actionType === "ReplaceSelection") {
        const latex = action.payload?.latex ?? "";
        const display = !!action.payload?.display;
        const markdown = action.payload?.markdown ?? (display ? `$$\n${latex}\n$$` : `$${latex}$`);

        await insertText(markdown);
        await bridge.complete(action.actionId, true, { inserted: true });
        statusBar.text = "$(check) LaTeXSnipper: formula inserted";
        setTimeout(() => { statusBar.text = "$(symbol-event) LaTeXSnipper"; }, 3000);
      }
    } catch {
      // Silent — background polling should not spam the user
    }
  }, 1500);

  return () => clearInterval(timer);
}
