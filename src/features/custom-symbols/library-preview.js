export const CUSTOM_SYMBOL_LIBRARY_KEY = "latexsnipper.custom-symbols.v1";

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_EDITOR_ASPECT_RATIO = 6;
const MIN_EDITOR_ASPECT_RATIO = 0.25;

function symbolCommand(bundle) {
  return String(
    bundle?.symbol?.latexCommand ?? bundle?.symbol?.latex_command ?? "",
  ).trim();
}

export function isValidCustomSymbolCommand(command) {
  return /^\\[A-Za-z@]+$/.test(String(command || "").trim());
}

const DIGIT_WORDS = Object.freeze([
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
]);

export function suggestValidCustomSymbolCommand(command) {
  const source = String(command || "")
    .trim()
    .replace(/^\\+/, "");
  const body = [...source]
    .map((character) =>
      /[0-9]/.test(character) ? DIGIT_WORDS[Number(character)] : character,
    )
    .join("")
    .replace(/[^A-Za-z@]/g, "");
  return `\\${body || "customSymbol"}`;
}

function svgArtifact(bundle) {
  const svg = bundle?.svg;
  return {
    mimeType: String(svg?.mimeType ?? svg?.mime_type ?? "").toLowerCase(),
    dataBase64: String(svg?.dataBase64 ?? svg?.data_base64 ?? "").trim(),
  };
}

export function readCustomSymbolLibrary(storage = globalThis.localStorage) {
  if (!storage?.getItem) return [];
  try {
    const value = JSON.parse(
      storage.getItem(CUSTOM_SYMBOL_LIBRARY_KEY) || "[]",
    );
    return Array.isArray(value) ? value.slice(0, 256) : [];
  } catch {
    return [];
  }
}

export function findCustomSymbolBundle(
  latex,
  storage = globalThis.localStorage,
) {
  const command = String(latex || "").trim();
  if (!isValidCustomSymbolCommand(command)) return null;
  return (
    readCustomSymbolLibrary(storage).find(
      (bundle) => symbolCommand(bundle) === command,
    ) || null
  );
}

function decodeBase64Svg(dataBase64) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error("CUSTOM_SYMBOL_SVG_BASE64_INVALID");
  }
  const binary = globalThis.atob(dataBase64);
  if (binary.length === 0 || binary.length > MAX_SVG_BYTES) {
    throw new Error("CUSTOM_SYMBOL_SVG_SIZE_INVALID");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function numericSvgLength(value) {
  const match = String(value || "")
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)/);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function svgAspectRatio(svg) {
  const openingTag = svg.match(/^\s*<svg\b[^>]*>/i)?.[0] || "";
  const viewBox = openingTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const values = viewBox
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2] > 0 &&
      values[3] > 0
    ) {
      return values[2] / values[3];
    }
  }
  const width = numericSvgLength(
    openingTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1],
  );
  const height = numericSvgLength(
    openingTag.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1],
  );
  return width && height ? width / height : 1;
}

function stableClassName(command) {
  let hash = 2166136261;
  for (const character of command) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `latexsnipper-custom-symbol-${(hash >>> 0).toString(36)}`;
}

export function isTrustedCustomSymbolHtmlContext(context) {
  return (
    context?.command === "\\class" &&
    /^latexsnipper-custom-symbol-[a-z0-9-]+$/.test(context.class || "")
  );
}

export function customSymbolPreview(bundle) {
  const artifact = svgArtifact(bundle);
  if (artifact.mimeType !== "image/svg+xml" || !artifact.dataBase64) {
    return null;
  }

  try {
    const svg = decodeBase64Svg(artifact.dataBase64);
    if (!/^\s*<svg\b/i.test(svg)) return null;
    if (
      /<\s*(?:script|foreignObject)\b/i.test(svg) ||
      /\son[a-z]+\s*=/i.test(svg) ||
      /(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|file:|javascript:)/i.test(svg)
    ) {
      return null;
    }
    return {
      symbolId: String(bundle?.symbol?.id || ""),
      command: symbolCommand(bundle),
      name: String(bundle?.symbol?.name || "自定义符号"),
      dataUrl: `data:image/svg+xml;base64,${artifact.dataBase64}`,
      aspectRatio: Math.min(
        MAX_EDITOR_ASPECT_RATIO,
        Math.max(MIN_EDITOR_ASPECT_RATIO, svgAspectRatio(svg)),
      ),
    };
  } catch {
    return null;
  }
}

export function listCustomSymbolPreviews(storage = globalThis.localStorage) {
  const commands = new Set();
  const previews = [];
  for (const bundle of readCustomSymbolLibrary(storage)) {
    const preview = customSymbolPreview(bundle);
    if (!preview || !preview.command || commands.has(preview.command)) {
      continue;
    }
    commands.add(preview.command);
    const usable = isValidCustomSymbolCommand(preview.command);
    previews.push({
      ...preview,
      usable,
      issue: usable
        ? null
        : "LaTeX 控制序列只能包含英文字母或 @；数字会被解析成普通字符。",
      suggestedCommand: usable
        ? preview.command
        : suggestValidCustomSymbolCommand(preview.command),
      macroName: usable ? preview.command.slice(1) : null,
      className: usable ? stableClassName(preview.command) : null,
    });
  }
  return previews;
}

export function customSymbolRenderSupport(storage = globalThis.localStorage) {
  const previews = listCustomSymbolPreviews(storage);
  const mathLiveMacros = {};
  const temmlMacros = {};
  const styleRules = [];

  for (const preview of previews) {
    if (!preview.usable) continue;
    const width = Math.max(0.5, preview.aspectRatio).toFixed(3);
    const definition = `\\class{${preview.className}}{\\rule{${width}em}{1em}}`;
    mathLiveMacros[preview.macroName] = {
      def: definition,
      captureSelection: true,
      expand: false,
    };
    temmlMacros[preview.command] = definition;
    styleRules.push(
      `.${preview.className}{display:inline-block;background-color:transparent!important;background-image:url("${preview.dataUrl}");background-position:center;background-repeat:no-repeat;background-size:contain;color:transparent;vertical-align:-0.12em}`,
      `.${preview.className}>*{opacity:0}`,
    );
  }

  return {
    previews,
    mathLiveMacros,
    temmlMacros,
    cssText: styleRules.join("\n"),
  };
}

export function renameCustomSymbolCommand(
  { symbolId = "", currentCommand = "", nextCommand = "" },
  storage = globalThis.localStorage,
) {
  const normalizedNext = String(nextCommand || "").trim();
  if (!isValidCustomSymbolCommand(normalizedNext)) {
    throw new Error("CUSTOM_SYMBOL_LATEX_COMMAND_INVALID");
  }
  const library = readCustomSymbolLibrary(storage);
  if (
    library.some(
      (bundle) =>
        symbolCommand(bundle) === normalizedNext &&
        String(bundle?.symbol?.id || "") !== String(symbolId || ""),
    )
  ) {
    throw new Error("CUSTOM_SYMBOL_LATEX_COMMAND_DUPLICATE");
  }
  const index = library.findIndex((bundle) => {
    const idMatches =
      symbolId && String(bundle?.symbol?.id || "") === String(symbolId);
    return idMatches || symbolCommand(bundle) === currentCommand;
  });
  if (index < 0) throw new Error("CUSTOM_SYMBOL_NOT_FOUND");
  const target = library[index];
  library[index] = {
    ...target,
    symbol: {
      ...target.symbol,
      latexCommand: normalizedNext,
    },
  };
  storage.setItem(CUSTOM_SYMBOL_LIBRARY_KEY, JSON.stringify(library));
  return normalizedNext;
}

export function createCustomSymbolPreviewNode(
  latex,
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
) {
  const bundle = findCustomSymbolBundle(latex, storage);
  const preview = bundle ? customSymbolPreview(bundle) : null;
  if (!preview || !documentRef?.createElement) return null;

  const image = documentRef.createElement("img");
  image.className = "custom-symbol-preview";
  image.src = preview.dataUrl;
  image.alt = `${preview.name}（${preview.command}）`;
  image.decoding = "async";
  image.draggable = false;
  return image;
}
