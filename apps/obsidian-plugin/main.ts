/**
 * LaTeXSnipper Obsidian Plugin v3.0
 *
 * All host operations route through router.dispatch("obsidian", cmd).
 * Settings and preview are provided via Obsidian's native API.
 */

import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Notice, Modal } from "obsidian";
import { ObsidianAdapter, ObsidianEditorAPI, ObsidianBridgeAPI } from "./obsidian.adapter";
import { router } from "../../core-protocol/command.router";

// ─── Settings ────────────────────────────────────────────────────────

interface LaTeXSnipperSettings {
  bridgeUrl: string;
  defaultDisplay: "inline" | "block";
  autoNumber: boolean;
}

const DEFAULT_SETTINGS: LaTeXSnipperSettings = {
  bridgeUrl: "https://127.0.0.1:19876",
  defaultDisplay: "inline",
  autoNumber: false,
};

// ─── Plugin ──────────────────────────────────────────────────────────

export default class LaTeXSnipperPlugin extends Plugin {
  settings!: LaTeXSnipperSettings;
  adapter!: ObsidianAdapter;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const editorFn = () => this.getEditor();
    const counterStore = {
      load: async () => {
        const data = await this.loadData();
        return data?.equationCounter || 0;
      },
      save: async (n: number) => {
        const data = (await this.loadData()) || {};
        data.equationCounter = n;
        await this.saveData(data);
      },
    };
    this.adapter = new ObsidianAdapter(editorFn, () => this.getBridge(), counterStore);
    router.register("obsidian", this.adapter);

    // ── Command palette entries ─────────────────────────────────────
    this.addCommand({
      id: "insert-inline-formula",
      name: "Insert inline formula",
      icon: "latex",
      callback: () => this.insertFormula("inline"),
    });

    this.addCommand({
      id: "insert-block-formula",
      name: "Insert block formula",
      icon: "latex",
      callback: () => this.insertFormula("block"),
    });

    this.addCommand({
      id: "insert-numbered-formula",
      name: "Insert numbered formula",
      icon: "list-numbers",
      callback: () => this.insertFormula("numbered"),
    });

    this.addCommand({
      id: "edit-formula",
      name: "Open formula editor",
      icon: "pencil",
      callback: () => this.openEditor(),
    });

    this.addCommand({
      id: "delete-selected-formula",
      name: "Delete selected formula",
      icon: "trash",
      callback: () => this.deleteSelected(),
    });

    this.addCommand({
      id: "wrap-selection-inline",
      name: "Wrap selection in inline formula",
      icon: "code",
      callback: () => this.wrapSelection("inline"),
    });

    this.addCommand({
      id: "wrap-selection-block",
      name: "Wrap selection in block formula",
      icon: "code",
      callback: () => this.wrapSelection("block"),
    });

    // ── Editor menu ─────────────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const sel = editor.getSelection();
        if (!sel) return;

        menu.addItem((item) => {
          item.setTitle("Inline formula ($...$)");
          item.setIcon("latex");
          item.onClick(() => {
            router.dispatch("obsidian", {
              type: "ReplaceSelection",
              payload: { content: `$${sel}$` },
            });
          });
        });

        menu.addItem((item) => {
          item.setTitle("Block formula ($$...$$)");
          item.setIcon("latex");
          item.onClick(() => {
            router.dispatch("obsidian", {
              type: "ReplaceSelection",
              payload: { content: `$$${sel}$$` },
            });
          });
        });
      }),
    );

    // ── Markdown post-processor ─────────────────────────────────────
    // Obsidian renders $...$ and $$...$$ natively via MathJax.
    // The plugin's job is to insert properly delimited formulas.
    // No custom post-processor needed — native rendering handles it.
    // (Removed; the old approach of injecting $ signs via textContent
    //  would not be picked up by MathJax at post-processor stage.)

    // ── Settings tab ────────────────────────────────────────────────
    this.addSettingTab(new LaTeXSnipperSettingTab(this.app, this));
  }

  // ─── Commands ──────────────────────────────────────────────────────

  insertFormula(display: "inline" | "block" | "numbered") {
    router.dispatch("obsidian", {
      type: "InsertFormula",
      payload: { latex: "", display },
    });
  }

  async openEditor() {
    const ed = this.getEditor();
    if (!ed) {
      new Notice("No active editor");
      return;
    }
    const sel = ed.getSelection();
    new FormulaEditorModal(this.app, sel, (latex, display, numbered) => {
      const mode = numbered ? "numbered" : (display as "inline" | "block");
      const delim = mode === "block" || mode === "numbered" ? "$$" : "$";
      router.dispatch("obsidian", {
        type: "InsertFormula",
        payload: { latex, display: mode },
      });
    }).open();
  }

  deleteSelected() {
    const ed = this.getEditor();
    if (!ed) { new Notice("No active editor"); return; }
    const sel = ed.getSelection();
    if (sel) {
      router.dispatch("obsidian", {
        type: "ReplaceSelection",
        payload: { content: "" },
      });
      new Notice("Deleted selected content");
    } else {
      new Notice("Nothing selected");
    }
  }

  wrapSelection(mode: "inline" | "block") {
    const ed = this.getEditor();
    if (!ed) { new Notice("No active editor"); return; }
    const sel = ed.getSelection();
    if (!sel) { new Notice("Nothing selected"); return; }
    const delim = mode === "block" ? "$$" : "$";
    router.dispatch("obsidian", {
      type: "ReplaceSelection",
      payload: { content: `${delim}${sel}${delim}` },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  getEditor(): ObsidianEditorAPI | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const ed = view.editor;
    return {
      getSelection: () => ed.getSelection(),
      replaceSelection: (text: string) => ed.replaceSelection(text),
      getValue: () => ed.getValue(),
      setValue: (text: string) => ed.setValue(text),
    };
  }

  getBridge(): ObsidianBridgeAPI | null {
    const url = this.settings.bridgeUrl;
    return {
      async convertLatex(latex: string, display: boolean): Promise<string | null> {
        try {
          const r = await fetch(`${url}/convert/latex`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latex, display, targets: ["omml"] }),
          });
          const d = await r.json();
          return d.result?.omml || null;
        } catch { return null; }
      },
      async convertOmml(omml: string): Promise<string | null> {
        try {
          const r = await fetch(`${url}/convert/omml`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ omml }),
          });
          const d = await r.json();
          return d.result?.latex || null;
        } catch { return null; }
      },
      async renderPreview(latex: string, display: boolean): Promise<string | null> {
        try {
          const r = await fetch(`${url}/convert/latex`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latex, display, targets: ["svg"] }),
          });
          const d = await r.json();
          return d.result?.svg_base64 || d.result?.svg || null;
        } catch { return null; }
      },
    };
  }
}

// ─── Formula Editor Modal (MathLive WYSIWYG) ─────────────────────────

import "mathlive";

class FormulaEditorModal extends Modal {
  private mf!: MathfieldElement;

  constructor(
    app: App,
    private initial: string,
    private onSubmit: (latex: string, display: "inline" | "block", numbered: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("latexsnipper-editor-modal");

    contentEl.createEl("h2", { text: "LaTeX Formula Editor" });

    // Insert/display mode bar
    const modeRow = contentEl.createDiv({ attr: { style: "display:flex;gap:16px;align-items:center;margin-bottom:8px;" } });
    const toggleLabel = modeRow.createEl("label", { attr: { style: "display:flex;align-items:center;gap:4px;font-size:13px;" } });
    const toggleCb = toggleLabel.createEl("input", { attr: { type: "checkbox" } });
  toggleLabel.appendText("Display mode ($$...$$)");
    const numberedLabel = modeRow.createEl("label", { attr: { style: "display:flex;align-items:center;gap:4px;font-size:13px;" } });
    const numberedCb = numberedLabel.createEl("input", { attr: { type: "checkbox" } });
    numberedLabel.appendText(" Numbered");

    // MathLive <math-field>
    this.mf = contentEl.createEl("math-field", {
      attr: {
        style: "width:100%;min-height:140px;font-size:18px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:6px;",
      },
    }) as MathfieldElement;
    this.mf.value = this.initial;
    this.mf.addEventListener("input", () => {
      // Update display toggle based on content
    });
    // Focus on open
    setTimeout(() => this.mf.focus(), 100);

    // Virtual keyboard toggle
    const keyboardToggle = contentEl.createEl("button", {
      text: "Toggle virtual keyboard",
      attr: { style: "font-size:12px;margin:4px 0 8px;padding:4px 10px;cursor:pointer;" },
    });
    keyboardToggle.addEventListener("click", () => {
      (this.mf as any).virtualKeyboardMode =
        (this.mf as any).virtualKeyboardMode === "manual" ? "off" : "manual";
    });

    // Help text
    contentEl.createEl("p", {
      text: "Type LaTeX directly, or use the visual toolbar and virtual keyboard.",
      attr: { style: "font-size:12px;color:var(--text-muted);margin:2px 0 6px;" },
    });

    // Action buttons
    const btnDiv = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:8px;" } });
    btnDiv.createEl("button", { text: "Cancel", attr: { style: "padding:6px 16px;cursor:pointer;" } })
      .addEventListener("click", () => this.close());
    const insertBtn = btnDiv.createEl("button", {
      text: "Insert",
      attr: {
        style: "background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px 16px;border-radius:4px;cursor:pointer;",
      },
    });
    insertBtn.addEventListener("click", () => {
      const latex = this.mf.value || "";
      const display = toggleCb.checked ? "block" : "inline";
      this.onSubmit(latex, display, numberedCb.checked);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ─── Settings Tab ────────────────────────────────────────────────────

class LaTeXSnipperSettingTab extends PluginSettingTab {
  plugin: LaTeXSnipperPlugin;

  constructor(app: App, plugin: LaTeXSnipperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "LaTeXSnipper Settings" });

    new Setting(containerEl)
      .setName("Bridge URL")
      .setDesc("LaTeXSnipper Desktop Bridge URL for formula conversion and preview")
      .addText((text) =>
        text
          .setPlaceholder("https://127.0.0.1:19876")
          .setValue(this.plugin.settings.bridgeUrl)
          .onChange(async (val) => {
            this.plugin.settings.bridgeUrl = val || "https://127.0.0.1:19876";
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(containerEl)
      .setName("Default display mode")
      .setDesc("Default formula display mode when inserting")
      .addDropdown((dd) =>
        dd
          .addOption("inline", "Inline ($...$)")
          .addOption("block", "Block ($$...$$)")
          .setValue(this.plugin.settings.defaultDisplay)
          .onChange(async (val) => {
            this.plugin.settings.defaultDisplay = val as "inline" | "block";
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(containerEl)
      .setName("Auto-number formulas")
      .setDesc("Automatically number inserted block formulas")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoNumber)
          .onChange(async (val) => {
            this.plugin.settings.autoNumber = val;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
  }
}
