import { describe, expect, it } from "vitest";
import {
  extractFormulaCandidates,
  parseTexCandidates,
} from "../src/formulas/pipeline";

describe("formula pipeline", () => {
  it("parses delimiters and environments without treating currency as math", () => {
    const text =
      "Price $5.99, but math $x^2+1$ and \\[\\frac{a}{b}\\] plus \\begin{align}a&=b\\end{align}.";
    const found = parseTexCandidates(text);
    expect(found.map((item) => item.normalizedLatex)).toContain("x^2+1");
    expect(
      found.some((item) => item.normalizedLatex === "5.99, but math "),
    ).toBe(false);
    expect(found.some((item) => item.rawSource.includes("begin{align}"))).toBe(
      true,
    );
  });
  it("ignores escaped dollars and markdown code", () => {
    expect(
      parseTexCandidates("\\$10 and `$x$` then $y_1$").map(
        (item) => item.normalizedLatex,
      ),
    ).toEqual(["y_1"]);
  });
  it("extracts KaTeX, MathJax, MathML, CJK and duplicate message origins", () => {
    document.body.innerHTML =
      '<div class="katex"><math><annotation encoding="application/x-tex">中文+x</annotation></math></div><mjx-container data-tex="y^2"></mjx-container><math><mi>z</mi></math>';
    const found = extractFormulaCandidates(document, {
      pageUrl: "https://example.test",
    });
    expect(found.some((item) => item.normalizedLatex === "中文+x")).toBe(true);
    expect(found.some((item) => item.normalizedLatex === "y^2")).toBe(true);
    expect(found.some((item) => item.mathml)).toBe(true);
  });
  it("handles long malformed text in bounded linear scanning", () => {
    expect(
      parseTexCandidates("$".repeat(100_000), { maxFormulas: 10 }).length,
    ).toBeLessThanOrEqual(10);
  });
});
