import * as vscode from "vscode";
import { BridgeClient } from "./bridge-client";
import { registerCommands } from "./commands";
import { startActionPoller } from "./action-poller";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log("[LaTeXSnipper] Activating...");

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(symbol-event) LaTeXSnipper";
  statusBarItem.tooltip = "LaTeXSnipper: click to insert inline formula";
  statusBarItem.command = "latexsnipper.insertInlineFormula";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Bridge client
  const bridge = new BridgeClient();

  // Register commands
  registerCommands(context, bridge);

  // Start polling for incoming actions
  const stopPoller = startActionPoller(bridge, statusBarItem);
  context.subscriptions.push({ dispose: stopPoller });

  // Register client
  bridge.register("vscode-default", "VS Code").catch(() => {
    statusBarItem.text = "$(warning) LaTeXSnipper (offline)";
    statusBarItem.tooltip = "LaTeXSnipper desktop not running";
  });

  // Periodic heartbeat
  const heartbeatTimer = setInterval(() => {
    bridge.heartbeat("vscode-default").catch(() => {});
  }, 10000);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatTimer) });

  console.log("[LaTeXSnipper] Activated.");
}

export function deactivate() {
  console.log("[LaTeXSnipper] Deactivated.");
}
