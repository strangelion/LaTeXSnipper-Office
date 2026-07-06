/**
 * LaTeXSnipper Office Web Add-in — Unified Adapter v3.0
 *
 * Implements the core-protocol HostAdapter interface for Microsoft Office.
 * Merges the OOXML construction from word.ts with the dispatch pattern
 * from adapter/office.adapter.ts into a single class supporting Word,
 * Excel, and PowerPoint via Office.js.
 *
 * Usage:
 *   import { OfficeHostAdapter } from "./adapters/unified-adapter";
 *   router.register("office", new OfficeHostAdapter());
 */

import type { Command, CommandResult } from "core-protocol/command.schema";
import type { HostAdapter } from "core-protocol/command.router";
import { WordOoxmlHelper } from "./word-ooxml";

declare const Word: any;
declare const Excel: any;
declare const Office: any;

export class OfficeHostAdapter implements HostAdapter {
  private ooxml = new WordOoxmlHelper();

  async execute(cmd: Command): Promise<CommandResult> {
    const host = await this.detectHost();
    switch (cmd.type) {
      // ── Formula insertion ─────────────────────────────────────────
      case "InsertFormula": {
        if (host === "word") return this._insertFormulaWord(cmd.payload);
        return this._insertFormulaGeneric(cmd.payload);
      }

      // ── Selection ─────────────────────────────────────────────────
      case "GetSelection":
        return this._getSelection(host);

      case "ReplaceSelection":
        return this._replaceSelection(host, cmd.payload.content);

      // ── Conversion ────────────────────────────────────────────────
      case "ConvertToLaTeX": {
        if (cmd.payload.omml) {
          return this._convertViaBridge("/api/office/convert", { omml: cmd.payload.omml });
        }
        return { ok: false, error: "No OMML provided" };
      }

      case "ConvertToOMML": {
        if (cmd.payload.latex) {
          return this._convertViaBridge("/api/office/convert", {
            latex: cmd.payload.latex,
            display: true,
          });
        }
        return { ok: false, error: "No LaTeX provided" };
      }

      // ── Preview ───────────────────────────────────────────────────
      case "RenderPreview": {
        return this._convertViaBridge("/convert/latex", {
          latex: cmd.payload.latex,
          display: cmd.payload.format === "svg" ? true : false,
          targets: [cmd.payload.format || "svg"],
        });
      }

      // ── Table ─────────────────────────────────────────────────────
      case "DetectTable":
        return { ok: true, data: "{}" }; // placeholder, full table support TBD

      // ── Formatting ────────────────────────────────────────────────
      case "FormatContent":
        return { ok: true }; // formatting applied client-side via OOXML

      // ── UI ────────────────────────────────────────────────────────
      case "OpenEditor":
      case "OpenSettings":
        return { ok: true };

      default:
        return { ok: false, error: `Unsupported: ${(cmd as any).type}` };
    }
  }

  // ─── Host detection ───────────────────────────────────────────────

  private async detectHost(): Promise<"word" | "excel" | "powerpoint"> {
    try {
      if (typeof Word !== "undefined" && Word.run) return "word";
      if (typeof Excel !== "undefined" && Excel.run) return "excel";
    } catch { /* ignore */ }
    return "powerpoint";
  }

  // ─── Word (OOXML via Word.run) — LaTeX → Bridge → OMML → insertOoxml ──

  private async _insertFormulaWord(payload: {
    latex: string;
    display?: string;
  }): Promise<CommandResult> {
    try {
      const isNumbered = payload.display === "numbered";
      const display = payload.display === "block" || isNumbered;

      // Step 1: Convert LaTeX to OMML via Bridge
      let omml: string | null = null;
      try {
        const base = this._bridgeBase();
        const res = await fetch(`${base}/api/office/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latex: payload.latex, display }),
        });
        const data = await res.json();
        if (data.success && data.omml) {
          omml = data.omml;
        }
      } catch { /* fallback to text wrapping below */ }

      // Step 2: Build OOXML — use real OMML if available, else text fallback
      const ooxml = omml
        ? (isNumbered
            ? this.ooxml.buildNumberedEquationOoxmlFromOmml(omml)
            : this.ooxml.buildOoxmlFromOmml(omml, display))
        : this.ooxml.buildFormulaOoxml(payload.latex, display);

      // Step 3: Insert into Word
      return Word.run(async (context: any) => {
        const sel = context.document.getSelection();
        sel.insertOoxml(ooxml, "Replace");
        await context.sync();
        return { ok: true };
      });
    } catch (e: any) {
      return { ok: false, error: `Word insert failed: ${e.message}` };
    }
  }

  // ─── Excel / PowerPoint (plain text) ──────────────────────────────

  private _insertFormulaGeneric(payload: {
    latex: string;
    display?: string;
  }): Promise<CommandResult> {
    const delim = payload.display === "block" ? "$$" : "$";
    const value = `${delim}${payload.latex}${delim}`;
    return new Promise((resolve) => {
      Office.context.document.setSelectedDataAsync(
        value,
        { coercionType: Office.CoercionType.Text },
        (r: any) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: r.error?.message || "Insert failed" });
          }
        },
      );
    });
  }

  // ─── Selection ────────────────────────────────────────────────────

  private _getSelection(host: string): Promise<CommandResult> {
    if (host === "word") return this._getSelectionWord();
    return this._getSelectionOffice();
  }

  private async _getSelectionWord(): Promise<CommandResult> {
    try {
      return Word.run(async (context: any) => {
        const sel = context.document.getSelection();
        const ooxml = sel.getOoxml();
        await context.sync();
        const text = this.ooxml.extractText(ooxml.value);
        return { ok: true, data: text };
      });
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  private _getSelectionOffice(): Promise<CommandResult> {
    return new Promise((resolve) => {
      Office.context.document.getSelectedDataAsync(
        Office.CoercionType.Text,
        (r: any) => resolve({ ok: true, data: r.value || "" }),
      );
    });
  }

  private _replaceSelection(host: string, content: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      Office.context.document.setSelectedDataAsync(
        content,
        { coercionType: Office.CoercionType.Text },
        (r: any) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: r.error?.message || "Replace failed" });
          }
        },
      );
    });
  }

  // ─── Bridge API helper ────────────────────────────────────────────

  private async _convertViaBridge(
    path: string,
    body: Record<string, unknown>,
  ): Promise<CommandResult> {
    const base = this._bridgeBase();
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { ok: true, data: JSON.stringify(data) };
    } catch (e: any) {
      return { ok: false, error: `Bridge error: ${e.message}` };
    }
  }

  private _bridgeBase(): string {
    const { hostname, port } = window.location;
    if ((hostname === "127.0.0.1" || hostname === "localhost") && port === "19876") {
      return "";
    }
    return "https://127.0.0.1:19876";
  }
}
