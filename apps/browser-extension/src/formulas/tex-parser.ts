import type { FormulaCandidate, FormulaScanOptions } from "./types";

const ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "cases",
]);

function idFor(source: string, offset: number): string {
  let hash = 2166136261;
  for (const char of `${offset}:${source}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `formula-${(hash >>> 0).toString(16)}`;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function looksLikeCurrency(
  source: string,
  before: string,
  after: string,
): boolean {
  const value = source.trim();
  return (
    /^\d[\d,.]*(?:\s*[-–—]\s*\d[\d,.]*)?$/.test(value) ||
    /^\d[\d,.]*\s+[A-Za-z]{2,}/.test(value) ||
    /(?:US|CN|HK|AU|CA)$/.test(before) ||
    /^\d/.test(after)
  );
}

function confidenceFor(source: string, currency: boolean): number {
  if (currency) return 0.15;
  let confidence = 0.62;
  if (/\\[A-Za-z]+/.test(source)) confidence += 0.2;
  if (/[_^{}=+*/<>]/.test(source)) confidence += 0.12;
  if (/[\u2200-\u22ff]/u.test(source)) confidence += 0.08;
  return Math.min(0.99, confidence);
}

function candidate(
  raw: string,
  latex: string,
  start: number,
  display: boolean,
  text: string,
  options: FormulaScanOptions,
): FormulaCandidate {
  const context = Math.min(options.contextCharacters ?? 80, 512);
  const before = text.slice(Math.max(0, start - context), start);
  const after = text.slice(start + raw.length, start + raw.length + context);
  return {
    id: idFor(raw, start),
    rawSource: raw,
    normalizedLatex: latex.trim(),
    displayMode: display ? "display" : "inline",
    source: "tex-delimiter",
    renderer: "plain-text",
    confidence: confidenceFor(
      latex,
      !display && looksLikeCurrency(latex, before, after),
    ),
    contextBefore: before,
    contextAfter: after,
    messageId: options.messageId,
    messageRole: options.messageRole,
    pageUrl: options.pageUrl ?? "",
  };
}

export function parseTexCandidates(
  text: string,
  options: FormulaScanOptions = {},
): FormulaCandidate[] {
  const results: FormulaCandidate[] = [];
  const max = Math.min(options.maxFormulas ?? 500, 500);
  const threshold = options.confidenceThreshold ?? 0.55;
  let inlineCode = false;
  let fencedCode = false;

  for (let i = 0; i < text.length && results.length < max; i += 1) {
    if (text.startsWith("```", i) && !isEscaped(text, i)) {
      fencedCode = !fencedCode;
      i += 2;
      continue;
    }
    if (!fencedCode && text[i] === "`" && !isEscaped(text, i)) {
      inlineCode = !inlineCode;
      continue;
    }
    if (inlineCode || fencedCode) continue;

    const env = text.startsWith("\\begin{", i)
      ? text.slice(i + 7, text.indexOf("}", i + 7))
      : "";
    if (ENVIRONMENTS.has(env)) {
      const close = `\\end{${env}}`;
      const end = text.indexOf(close, i + 8 + env.length);
      if (end >= 0) {
        const raw = text.slice(i, end + close.length);
        results.push(candidate(raw, raw, i, true, text, options));
        i = end + close.length - 1;
      }
      continue;
    }

    let open = "";
    let close = "";
    let display = false;
    if (text.startsWith("$$", i) && !isEscaped(text, i))
      [open, close, display] = ["$$", "$$", true];
    else if (text.startsWith("\\[", i))
      [open, close, display] = ["\\[", "\\]", true];
    else if (text.startsWith("\\(", i)) [open, close] = ["\\(", "\\)"];
    else if (text[i] === "$" && !isEscaped(text, i)) [open, close] = ["$", "$"];
    if (!open) continue;

    let end = i + open.length;
    let braceDepth = 0;
    while (end < text.length) {
      if (text[end] === "{" && !isEscaped(text, end)) braceDepth += 1;
      if (text[end] === "}" && !isEscaped(text, end) && braceDepth > 0)
        braceDepth -= 1;
      if (
        braceDepth === 0 &&
        text.startsWith(close, end) &&
        !isEscaped(text, end)
      )
        break;
      end += 1;
    }
    if (end >= text.length) continue;
    const raw = text.slice(i, end + close.length);
    const latex = text.slice(i + open.length, end);
    if (latex.trim()) {
      const found = candidate(raw, latex, i, display, text, options);
      if (found.confidence >= threshold) {
        results.push(found);
        i = end + close.length - 1;
      }
    }
  }
  return results;
}
