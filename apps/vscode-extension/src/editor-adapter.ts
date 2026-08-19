import * as vscode from "vscode";

export function getActiveEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("No active editor.");
  return editor;
}

export async function insertText(text: string) {
  const editor = getActiveEditor();
  const applied = await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
  if (!applied) {
    throw new Error("EDITOR_EDIT_REJECTED");
  }
}

export function getSelectedText(): string {
  const editor = getActiveEditor();
  return editor.document.getText(editor.selection);
}

function decodePngBase64(value: string): Uint8Array {
  const encoded = value.replace(/^data:image\/png;base64,/, "");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < signature.length ||
    signature.some((signatureByte, index) => bytes[index] !== signatureByte)
  ) {
    throw new Error("VSCODE_IMAGE_INVALID_PNG");
  }
  if (bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("VSCODE_IMAGE_TOO_LARGE");
  }
  return bytes;
}

function safeImageName(value: string): string {
  const stem = value
    .replace(/\.png$/i, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "latexsnipper-image"}.png`;
}

export async function insertPngAttachment(
  pngBase64: string,
  fileName = "latexsnipper-image.png",
  altText = "LaTeXSnipper image",
) {
  const editor = getActiveEditor();
  if (editor.document.uri.scheme !== "file") {
    throw new Error("VSCODE_IMAGE_REQUIRES_FILE_DOCUMENT");
  }
  const bytes = decodePngBase64(pngBase64);
  const documentFolder = vscode.Uri.joinPath(editor.document.uri, "..");
  const assetFolder = vscode.Uri.joinPath(
    documentFolder,
    ".latexsnipper-assets",
  );
  await vscode.workspace.fs.createDirectory(assetFolder);

  const baseName = safeImageName(fileName);
  const stem = baseName.replace(/\.png$/i, "");
  let name = baseName;
  let target = vscode.Uri.joinPath(assetFolder, name);
  let suffix = 2;
  while (true) {
    try {
      await vscode.workspace.fs.stat(target);
      name = `${stem}-${suffix}.png`;
      target = vscode.Uri.joinPath(assetFolder, name);
      suffix += 1;
    } catch {
      break;
    }
  }
  await vscode.workspace.fs.writeFile(target, bytes);
  const safeAlt =
    altText.replace(/[\]\\]/g, " ").trim() || "LaTeXSnipper image";
  await insertText(
    `![${safeAlt}](.latexsnipper-assets/${encodeURIComponent(name)})`,
  );
  return { path: target.fsPath, bytes: bytes.byteLength };
}
