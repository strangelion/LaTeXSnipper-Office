// LaTeXSnipper v3.0 — Obsidian Adapter
// Communicates with the Obsidian editor via its API.

import { Command, CommandResult } from "../../core-protocol/command.schema";
import { HostAdapter } from "../../core-protocol/command.router";

export interface ObsidianEditorAPI {
  getSelection(): string;
  replaceSelection(text: string): void;
  getValue(): string;
  setValue(text: string): void;
}

export class ObsidianAdapter implements HostAdapter {
  constructor(private editor: () => ObsidianEditorAPI | null) {}

  async execute(cmd: Command): Promise<CommandResult> {
    const ed = this.editor();
    if (!ed) return { ok: false, error: "No active editor" };

    switch (cmd.type) {
      case "InsertFormula": {
        const delim = cmd.payload.display === "block" ? "$$" : "$";
        ed.replaceSelection(`${delim}${cmd.payload.latex}${delim}`);
        return { ok: true };
      }
      case "GetSelection": {
        return { ok: true, data: ed.getSelection() };
      }
      case "ReplaceSelection": {
        ed.replaceSelection(cmd.payload.content);
        return { ok: true };
      }
      default:
        return { ok: false, error: `Unsupported: ${cmd.type}` };
    }
  }
}
