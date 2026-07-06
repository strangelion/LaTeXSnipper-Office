import { App, Plugin, PluginSettingTab, Setting, MarkdownView } from "obsidian";
import { ObsidianAdapter, ObsidianEditorAPI } from "./obsidian.adapter";
import { router } from "../core-protocol/command.router";

export default class LaTeXSnipperPlugin extends Plugin {
  adapter!: ObsidianAdapter;

  async onload() {
    this.adapter = new ObsidianAdapter(() => this.getEditor());
    router.register("obsidian", this.adapter);

    this.addCommand({
      id: "insert-inline-formula",
      name: "Insert inline formula",
      callback: () => this.insertFormula("inline")
    });

    this.addCommand({
      id: "insert-block-formula",
      name: "Insert block formula",
      callback: () => this.insertFormula("block")
    });

    this.registerMarkdownPostProcessor((el) => {
      el.querySelectorAll("code.language-latex").forEach((code) => {
        const text = code.textContent || "";
        code.innerHTML = `$${text}$`;
      });
    });
  }

  insertFormula(display: "inline" | "block") {
    router.dispatch("obsidian", {
      type: "InsertFormula",
      payload: { latex: "", display }
    });
  }

  getEditor(): ObsidianEditorAPI | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const ed = view.editor;
    return {
      getSelection: () => ed.getSelection(),
      replaceSelection: (text: string) => ed.replaceSelection(text),
      getValue: () => ed.getValue(),
      setValue: (text: string) => ed.setValue(text)
    };
  }
}
