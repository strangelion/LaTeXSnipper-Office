import * as vscode from "vscode";
import { BridgeClient } from "./bridge-client";
import { insertText, getSelectedText } from "./editor-adapter";

export function registerCommands(
  context: vscode.ExtensionContext,
  bridge: BridgeClient,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "latexsnipper.insertInlineFormula",
      async () => {
        await insertText("$ $");
        vscode.window.showInformationMessage(
          "Inline formula placeholder inserted.",
        );
      },
    ),

    vscode.commands.registerCommand(
      "latexsnipper.insertDisplayFormula",
      async () => {
        await insertText("$$\n\n$$");
        vscode.window.showInformationMessage(
          "Display formula placeholder inserted.",
        );
      },
    ),

    vscode.commands.registerCommand(
      "latexsnipper.openSelectionInDesktop",
      async () => {
        const latex = getSelectedText();
        if (!latex.trim()) {
          vscode.window.showWarningMessage("No formula selected.");
          return;
        }

        try {
          await bridge.enqueue({
            actionType: "EditFormula",
            origin: "vscode",
            target: "desktop",
            timeoutMs: 300_000,
            payload: {
              latex,
              display: latex.includes("\n") || latex.startsWith("$$"),
              source: "vscode-selection",
            },
          });
          vscode.window.showInformationMessage("Sent to LaTeXSnipper.");
        } catch (e: any) {
          vscode.window.showErrorMessage(
            `Failed to send to LaTeXSnipper: ${e.message}`,
          );
        }
      },
    ),
  );
}
