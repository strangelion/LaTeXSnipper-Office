// LaTeXSnipper v3.0 — WPS Adapter
// Uses WPS JSAPI for document interaction.

import { Command, CommandResult } from "../../core-protocol/command.schema";
import { HostAdapter } from "../../core-protocol/command.router";

declare const WPS: any;

export class WPSAdapter implements HostAdapter {
  async execute(cmd: Command): Promise<CommandResult> {
    const api = (window as any).WPS?.Api;
    if (!api) return { ok: false, error: "WPS API not available" };

    switch (cmd.type) {
      case "InsertFormula": {
        api.Selection.InsertText(cmd.payload.latex);
        return { ok: true };
      }
      case "GetSelection": {
        const text = api.Selection.Text;
        return { ok: true, data: text };
      }
      case "ReplaceSelection": {
        api.Selection.Text = cmd.payload.content;
        return { ok: true };
      }
      case "OpenEditor":
      case "OpenSettings":
        return { ok: true };
      default:
        return { ok: false, error: `Unsupported command: ${cmd.type}` };
    }
  }
}
