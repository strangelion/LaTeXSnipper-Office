import * as vscode from "vscode";

export function getActiveEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("No active editor.");
  return editor;
}

export async function insertText(text: string) {
  const editor = getActiveEditor();
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}

export function getSelectedText(): string {
  const editor = getActiveEditor();
  return editor.document.getText(editor.selection);
}
