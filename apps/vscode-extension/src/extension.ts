import * as vscode from "vscode";
import { BridgeClient } from "./bridge-client";
import { registerCommands } from "./commands";
import { startActionPoller } from "./action-poller";

let statusBarItem: vscode.StatusBarItem;

export async function activate(
  context: vscode.ExtensionContext,
) {
  console.log("[LaTeXSnipper] Activating...");

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(symbol-event) LaTeXSnipper";
  statusBarItem.tooltip = "LaTeXSnipper: click to insert inline formula";
  statusBarItem.command = "latexsnipper.insertInlineFormula";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Generate stable client ID
  let clientId =
    context.globalState.get<string>(
      "latexsnipper.ecosystemClientId",
    );

  if (!clientId) {
    clientId = `vscode-${crypto.randomUUID()}`;

    await context.globalState.update(
      "latexsnipper.ecosystemClientId",
      clientId,
    );
  }

  // Bridge client
  const bridge = new BridgeClient(clientId);

  // Register commands
  registerCommands(context, bridge);

  // Start polling for incoming actions
  const stopPoller = startActionPoller(bridge, statusBarItem);
  context.subscriptions.push({ dispose: stopPoller });

  // Register client, then auto-re-register if heartbeat shows not registered
  bridge.register("VS Code").catch(() => {
    statusBarItem.text = "$(warning) LaTeXSnipper (offline)";
    statusBarItem.tooltip = "LaTeXSnipper desktop not running";
  });

  // Periodic heartbeat with auto-reconnect
  const heartbeatTimer = setInterval(async () => {
    try {
      const result: any = await bridge.heartbeat();
      if (result?.registered === false) {
        // Desktop restarted or client was lost, re-register
        await bridge.register("VS Code").catch(() => {});
      }
    } catch {
      // Desktop offline, will retry next heartbeat
    }
  }, 10000);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatTimer) });

  console.log("[LaTeXSnipper] Activated.");
}

export function deactivate() {
  console.log("[LaTeXSnipper] Deactivated.");
}
