import type { Command, CommandResult } from "core-protocol/command.schema";
import type { HostAdapter } from "core-protocol/command.router";
import { createFormulaId, validateFormulaPayload, type FormulaDisplayMode, type OfficeFormulaPayload } from "../model/formula-payload";
import { detectOfficeHost } from "./host-detection";
import type { OfficeFormulaHostAdapter } from "./office-host-adapter";
import { WordFormulaAdapter } from "./word-adapter";
import { ExcelFormulaAdapter } from "./excel-adapter";
import { PowerPointFormulaAdapter } from "./powerpoint-adapter";
import { OfficeBridgeClient } from "./bridge-client";

export class OfficeHostAdapter implements HostAdapter {
  private readonly bridge = new OfficeBridgeClient();
  private readonly adapters: Record<"word" | "excel" | "powerpoint", OfficeFormulaHostAdapter> = {
    word: new WordFormulaAdapter(this.bridge),
    excel: new ExcelFormulaAdapter(this.bridge),
    powerpoint: new PowerPointFormulaAdapter(this.bridge),
  };

  async execute(command: Command): Promise<CommandResult> {
    const adapter = this.currentAdapter();
    if (!adapter) return { ok: false, code: "UNSUPPORTED_HOST", error: "This Microsoft Office host is not supported." };

    switch (command.type) {
      case "InsertFormula":
        return this.toCommandResult(await adapter.insertFormula(this.payloadFromCommand(command.payload)));
      case "GetSelectedFormula":
        return this.toCommandResult(await adapter.getSelectedFormula());
      case "ReplaceSelectedFormula": {
        const selected = await adapter.getSelectedFormula();
        if (!selected.ok || !selected.data) return this.toCommandResult(selected);
        return this.toCommandResult(await adapter.replaceSelectedFormula(this.payloadFromCommand({ ...command.payload, formulaId: selected.data.formulaId })));
      }
      case "DeleteSelectedFormula":
        return this.toCommandResult(await adapter.deleteSelectedFormula());
      case "InsertEquationReference":
        return this.toCommandResult(await adapter.insertEquationReference(command.payload.formulaId));
      case "GetHostCapabilities":
        return { ok: true, data: await adapter.getCapabilities() };
      case "GetSelection":
        return this.toCommandResult(await adapter.getSelectedFormula());
      case "ReplaceSelection":
        return { ok: false, code: "UNSAFE_GENERIC_REPLACE", error: "Generic selection replacement is disabled for formula operations. Use ReplaceSelectedFormula." };
      case "ConvertToLaTeX": {
        try {
          return { ok: true, data: await this.bridge.convert("omml", "latex", command.payload.omml, "inline") };
        } catch (error) {
          return this.bridgeFailure(error);
        }
      }
      case "ConvertToOMML": {
        try {
          return { ok: true, data: await this.bridge.convert("latex", "omml", command.payload.latex, "block") };
        } catch (error) {
          return this.bridgeFailure(error);
        }
      }
      case "RenderFormula":
      case "RenderPreview": {
        try {
          const format = command.type === "RenderFormula" ? (command.payload.format ?? "png") : "svg";
          const displayMode: FormulaDisplayMode = command.type === "RenderFormula" ? (command.payload.display ?? "block") : "block";
          return { ok: true, data: await this.bridge.convert("latex", format, command.payload.latex, displayMode) };
        } catch (error) {
          return this.bridgeFailure(error);
        }
      }
      case "DetectTable":
        return { ok: false, code: "TABLE_UNSUPPORTED", error: "Table extraction is not supported by this Office.js adapter." };
      case "FormatContent":
        return { ok: false, code: "FORMAT_UNSUPPORTED", error: "Global formatting is intentionally not applied by the Office.js formula adapter." };
      case "OpenEditor":
      case "OpenSettings":
        return { ok: true };
      default:
        return { ok: false, error: `Unsupported command: ${(command as { type: string }).type}` };
    }
  }

  private currentAdapter(): OfficeFormulaHostAdapter | null {
    const host = detectOfficeHost();
    return host === "word" || host === "excel" || host === "powerpoint" ? this.adapters[host] : null;
  }

  private payloadFromCommand(input: {
    latex: string;
    display?: FormulaDisplayMode;
    formulaId?: string;
    layoutProfileId?: string;
    equationLabel?: string;
  }): OfficeFormulaPayload {
    return validateFormulaPayload({
      schemaVersion: 1,
      formulaId: input.formulaId || createFormulaId(),
      latex: input.latex,
      displayMode: input.display ?? "inline",
      layoutProfileId: input.layoutProfileId,
      equationLabel: input.equationLabel,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  private toCommandResult(result: { ok: boolean; data?: unknown; error?: string; code?: string }): CommandResult {
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error ?? "Office operation failed", code: result.code };
  }

  private bridgeFailure(error: unknown): CommandResult {
    return { ok: false, code: "BRIDGE_UNAVAILABLE", error: error instanceof Error ? error.message : String(error) };
  }
}
