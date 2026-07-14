import { parseTexCandidates } from "./tex-parser";
import type { FormulaCandidate, FormulaScanOptions } from "./types";

function fingerprint(value: string): string {
  let hash = 5381;
  for (const char of value) hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  return (hash >>> 0).toString(16);
}

function visible(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true" || element.closest("[hidden]")) return false;
  const style = (element as HTMLElement).style;
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function fromDom(element: Element, options: FormulaScanOptions): FormulaCandidate | null {
  if (!visible(element)) return null;
  const annotation = element.matches('annotation[encoding="application/x-tex"]')
    ? element
    : element.querySelector('annotation[encoding="application/x-tex"]');
  const dataSource = element.getAttribute("data-tex") || element.getAttribute("data-math");
  const script = element.matches('script[type^="math/tex"]') ? element : null;
  const latex = annotation?.textContent?.trim() || dataSource?.trim() || script?.textContent?.trim();
  const isMathMl = element.localName === "math";
  if (!latex && !isMathMl) return null;
  const katex = !!element.closest(".katex, .katex-display") || element.classList.contains("katex");
  const mathjax = element.localName === "mjx-container" || !!element.closest("mjx-container");
  const display = !!element.closest(".katex-display, mjx-container[display='true']") || element.getAttribute("type")?.includes("mode=display");
  const raw = latex || element.outerHTML.slice(0, 64 * 1024);
  return {
    id: `dom-${fingerprint(`${options.messageId || ""}:${raw}`)}`,
    rawSource: raw,
    normalizedLatex: latex || undefined,
    mathml: isMathMl ? element.outerHTML : undefined,
    conversionRequired: isMathMl && !latex,
    displayMode: display ? "display" : "inline",
    source: isMathMl ? "mathml" : katex ? "katex" : mathjax ? "mathjax" : "dom-attribute",
    renderer: isMathMl ? "mathml" : katex ? "katex" : mathjax ? "mathjax" : "unknown",
    confidence: latex ? 0.98 : 0.85,
    messageId: options.messageId,
    messageRole: options.messageRole,
    pageUrl: options.pageUrl ?? "",
    elementFingerprint: fingerprint(element.outerHTML.slice(0, 2048)),
  };
}

function dedupe(items: FormulaCandidate[], preserveMessages = true): FormulaCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.normalizedLatex?.normalize("NFC") || item.mathml?.normalize("NFC") || item.rawSource.normalize("NFC");
    const key = `${item.displayMode}:${preserveMessages ? item.messageId || "" : ""}:${item.elementFingerprint || ""}:${normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractFormulaCandidates(root: ParentNode, options: FormulaScanOptions = {}): FormulaCandidate[] {
  const max = Math.min(options.maxFormulas ?? 500, 500);
  const results: FormulaCandidate[] = [];
  const selectors = [
    'script[type^="math/tex"]', 'annotation[encoding="application/x-tex"]',
    ".katex", ".katex-display", "mjx-container", "math", "[data-tex]", "[data-math]",
  ].join(",");
  for (const element of Array.from(root.querySelectorAll(selectors)).slice(0, max * 3)) {
    const item = fromDom(element, options);
    if (item) results.push(item);
    if (results.length >= max) break;
  }
  const text = (root as HTMLElement).innerText || root.textContent || "";
  results.push(...parseTexCandidates(text.slice(0, 2 * 1024 * 1024), { ...options, maxFormulas: max - results.length }));
  return dedupe(results).slice(0, max);
}

export { parseTexCandidates } from "./tex-parser";
export type { FormulaCandidate } from "./types";
