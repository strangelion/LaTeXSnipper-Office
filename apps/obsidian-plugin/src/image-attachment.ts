import { MarkdownView, normalizePath, Plugin } from "obsidian";

function decodePngBase64(value: string): Uint8Array {
  const encoded = value.replace(/^data:image\/png;base64,/, "");
  const binary = globalThis.atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < signature.length ||
    signature.some((signatureByte, index) => bytes[index] !== signatureByte)
  ) {
    throw new Error("OBSIDIAN_IMAGE_INVALID_PNG");
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
  plugin: Plugin,
  pngBase64: string,
  fileName = "latexsnipper-image.png",
  altText = "LaTeXSnipper image",
) {
  const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
  if (!editor) throw new Error("No active Markdown editor");
  const bytes = decodePngBase64(pngBase64);
  if (bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("OBSIDIAN_IMAGE_TOO_LARGE");
  }

  const folder = normalizePath("LaTeXSnipper Assets");
  if (!plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder);
  }
  const baseName = safeImageName(fileName);
  const stem = baseName.replace(/\.png$/i, "");
  let path = normalizePath(`${folder}/${baseName}`);
  let suffix = 2;
  while (plugin.app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${folder}/${stem}-${suffix}.png`);
    suffix += 1;
  }
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await plugin.app.vault.createBinary(path, data);
  const safeAlt =
    altText.replace(/[\]\\]/g, " ").trim() || "LaTeXSnipper image";
  editor.replaceSelection(`![${safeAlt}](${encodeURI(path)})`);
  return { path, bytes: bytes.byteLength };
}
