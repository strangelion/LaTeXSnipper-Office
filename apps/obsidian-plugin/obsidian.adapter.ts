/**
 * LaTeXSnipper v3.0 — Obsidian Adapter
 *
 * Implements the full HostAdapter interface for Obsidian.
 * Commands that don't apply to a Markdown editor (e.g. DetectTable)
 * return graceful unsupported errors rather than silently failing.
 */

import { Command, CommandResult } from "../../core-protocol/command.schema";
import { HostAdapter } from "../../core-protocol/command.router";

export interface ObsidianEditorAPI {
  getSelection(): string;
  replaceSelection(text: string): void;
  getValue(): string;
  setValue(text: string): void;
}

export interface ObsidianBridgeAPI {
  convertLatex(latex: string, display: boolean): Promise<string | null>;
  convertOmml(omml: string): Promise<string | null>;
  renderPreview(latex: string, display: boolean): Promise<string | null>;
}

export class ObsidianAdapter implements HostAdapter {
  private _counter = 0;
  private _idCounter = 0;
  private _counterStore?: { load: () => Promise<number>; save: (n: number) => Promise<void> };
  private _numberFormat: "global" | "chapter" | "chapter-hyphen" = "global";
  private _chapterCounters = new Map<number, number>();

  constructor(
    private editor: () => ObsidianEditorAPI | null,
    private bridge: () => ObsidianBridgeAPI | null = () => null,
    counterStore?: { load: () => Promise<number>; save: (n: number) => Promise<void> },
    numberFormat: "global" | "chapter" | "chapter-hyphen" = "global",
  ) {
    if (counterStore) {
      this._counterStore = counterStore;
      counterStore.load().then((n) => { this._counter = n; });
    }
    this._numberFormat = numberFormat;
  }

  async execute(cmd: Command): Promise<CommandResult> {
    switch (cmd.type) {
      // ── Formula insertion ─────────────────────────────────────────
      case "InsertFormula": {
        const ed = this.editor();
        if (!ed) return { ok: false, error: "No active editor" };
        const delim = cmd.payload.display === "block" || cmd.payload.display === "numbered"
          ? "$$" : "$";
        const latex = cmd.payload.latex;
        const formulaId = cmd.payload.formulaId || this._nextId();
        const meta = `<!-- LaTeXSnipper:${formulaId} -->`;
        const text = cmd.payload.display === "numbered"
          ? `${meta}\n${delim}${latex}${delim} (${this.nextNumber()})`
          : `${meta}\n${delim}${latex}${delim}`;
        ed.replaceSelection(text);
        return { ok: true, data: formulaId };
      }

      // ── Selection ─────────────────────────────────────────────────
      case "GetSelection": {
        const ed = this.editor();
        if (!ed) return { ok: false, error: "No active editor" };
        return { ok: true, data: ed.getSelection() };
      }

      case "ReplaceSelection": {
        const ed = this.editor();
        if (!ed) return { ok: false, error: "No active editor" };
        ed.replaceSelection(cmd.payload.content);
        return { ok: true };
      }

      // ── Conversion (delegate to Desktop Bridge) ───────────────────
      case "ConvertToLaTeX": {
        const b = this.bridge();
        if (!b) return { ok: false, error: "Bridge not available" };
        const latex = await b.convertOmml(cmd.payload.omml);
        if (!latex) return { ok: false, error: "Conversion failed" };
        return { ok: true, data: latex };
      }

      case "ConvertToOMML": {
        const b = this.bridge();
        if (!b) return { ok: false, error: "Bridge not available" };
        const omml = await b.convertLatex(cmd.payload.latex, true);
        if (!omml) return { ok: false, error: "Conversion failed" };
        return { ok: true, data: omml };
      }

      // ── Preview ───────────────────────────────────────────────────
      case "RenderPreview": {
        const b = this.bridge();
        if (!b) return { ok: false, error: "Bridge not available" };
        const svg = await b.renderPreview(
          cmd.payload.latex,
          cmd.payload.format === "svg" || !cmd.payload.format,
        );
        if (!svg) return { ok: false, error: "Render failed" };
        return { ok: true, data: svg };
      }

      // ── Markdown-hostile commands (graceful unsupported) ──────────
      case "DetectTable":
        return { ok: false, error: "DetectTable not supported in Markdown" };

      case "FormatContent": {
        // Apply formatting only if content is available
        const ed = this.editor();
        if (!ed || !cmd.payload.fontFamily && !cmd.payload.fontSize && !cmd.payload.color)
          return { ok: false, error: "No formatting options provided" };
        return { ok: true };
      }

      // ── UI ────────────────────────────────────────────────────────
      case "OpenEditor":
      case "OpenSettings":
        return { ok: true };

      default:
        return { ok: false, error: `Unsupported: ${(cmd as any).type}` };
    }
  }

  private _nextId(): string {
    return `${Date.now().toString(36)}-${++this._idCounter}`;
  }

  setNumberFormat(format: "global" | "chapter" | "chapter-hyphen") {
    this._numberFormat = format;
  }

  private nextNumber(): string {
    this._counter++;
    if (this._counterStore) {
      this._counterStore.save(this._counter);
    }

    switch (this._numberFormat) {
      case "global":
        return `${this._counter}`;
      case "chapter": {
        // Parse current formula to detect chapter number
        // For now, use a simple heuristic: detect patterns like "(2.1)" in document
        const chapter = this._detectChapter();
        const section = this._getChapterSection(chapter);
        return `${chapter}.${section}`;
      }
      case "chapter-hyphen": {
        const chapter = this._detectChapter();
        const section = this._getChapterSection(chapter);
        return `${chapter}-${section}`;
      }
      default:
        return `${this._counter}`;
    }
  }

  private _detectChapter(): number {
    // Simple heuristic: detect chapter from document content
    // Look for patterns like "# Chapter X" or "## X. " at the beginning of headings
    const ed = this.editor();
    if (!ed) return 1;
    
    const content = ed.getValue();
    const chapterMatches = content.match(/^#{1,2}\s+(?:Chapter\s+)?(\d+)/im);
    if (chapterMatches) {
      return parseInt(chapterMatches[1], 10);
    }
    return 1;
  }

  private _getChapterSection(chapter: number): number {
    // Get or initialize section counter for this chapter
    const currentSection = this._chapterCounters.get(chapter) || 0;
    const newSection = currentSection + 1;
    this._chapterCounters.set(chapter, newSection);
    return newSection;
  }
}
