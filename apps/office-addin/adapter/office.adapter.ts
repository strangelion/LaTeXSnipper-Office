// LaTeXSnipper v3.0 — Office Web Add-in Adapter

import { Command, CommandResult } from "../../core-protocol/command.schema";
import { HostAdapter } from "../../core-protocol/command.router";

declare const Office: any;

export class OfficeAdapter implements HostAdapter {
  async execute(cmd: Command): Promise<CommandResult> {
    switch (cmd.type) {
      case "InsertFormula": {
        return new Promise((res) => {
          Office.context.document.setSelectedDataAsync(
            cmd.payload.latex,
            { coercionType: Office.CoercionType.Text },
            () => res({ ok: true })
          );
        });
      }
      case "GetSelection": {
        return new Promise((res) => {
          Office.context.document.getSelectedDataAsync(
            Office.CoercionType.Text,
            (r: any) => res({ ok: true, data: r.value || "" })
          );
        });
      }
      case "ReplaceSelection": {
        return new Promise((res) => {
          Office.context.document.setSelectedDataAsync(
            cmd.payload.content,
            { coercionType: Office.CoercionType.Text },
            () => res({ ok: true })
          );
        });
      }
      default:
        return { ok: false, error: `Unsupported: ${cmd.type}` };
    }
  }
}
