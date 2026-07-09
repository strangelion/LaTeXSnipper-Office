export interface FormulaCandidate {
  latex: string;
  display: boolean;
  source: "selection" | "markdown" | "katex" | "mathjax" | "annotation" | "script";
  confidence: number;
}

export function extractLatexFromText(text: string): FormulaCandidate[] {
  const results: FormulaCandidate[] = [];
  const patterns = [
    { re: /\$\$([\s\S]+?)\$\$/g, display: true },
    { re: /\\\[([\s\S]+?)\\\]/g, display: true },
    { re: /\$([^$\n]+?)\$/g, display: false },
    { re: /\\\(([\s\S]+?)\\\)/g, display: false },
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const latex = m[1]?.trim();
      if (latex) results.push({ latex, display: p.display, source: "markdown", confidence: 0.9 });
    }
  }
  return dedupe(results);
}

export function extractFormulasFromDocument(doc: Document): FormulaCandidate[] {
  const results: FormulaCandidate[] = [];
  doc.querySelectorAll('script[type="math/tex"], script[type="math/tex; mode=display"]').forEach((el) => {
    const latex = el.textContent?.trim();
    if (latex) results.push({ latex, display: el.getAttribute("type")?.includes("display") ?? false, source: "script", confidence: 0.95 });
  });
  doc.querySelectorAll('annotation[encoding="application/x-tex"]').forEach((el) => {
    const latex = el.textContent?.trim();
    if (latex) results.push({ latex, display: !!el.closest(".katex-display, mjx-container[display='true']"), source: "annotation", confidence: 0.95 });
  });
  results.push(...extractLatexFromText(doc.body?.innerText ?? ""));
  return dedupe(results);
}

function dedupe(items: FormulaCandidate[]): FormulaCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.display}:${item.latex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
