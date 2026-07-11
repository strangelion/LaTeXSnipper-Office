import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(
  root,
  "apps",
  "native-office",
  "fixtures",
  "mathjax-svg",
);
const fixtures = [
  {
    name: "fraction-radical",
    tex: String.raw`\frac{\sqrt{x^2+1}}{y_1}`,
    display: true,
  },
  {
    name: "integral-sum",
    tex: String.raw`\int_0^\infty e^{-x}\,dx=\sum_{n=1}^{\infty}\frac1{2^n}`,
    display: true,
  },
  {
    name: "matrix-cases",
    tex: String.raw`A=\begin{pmatrix}a&b\\c&d\end{pmatrix},\quad f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,
    display: true,
  },
  {
    name: "inline-greek",
    tex: String.raw`\alpha+\beta\to\gamma`,
    display: false,
  },
];

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document("", {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: "none" }),
});
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");

mkdirSync(fixtureDir, { recursive: true });
let changed = false;
for (const fixture of fixtures) {
  const container = document.convert(fixture.tex, { display: fixture.display });
  const html = adaptor.outerHTML(container);
  const start = html.indexOf("<svg");
  const end = html.lastIndexOf("</svg>");
  if (start < 0 || end < start)
    throw new Error(`MathJax did not emit SVG for ${fixture.name}`);
  const svg = normalizeLineEndings(`${html.slice(start, end + 6)}\n`);
  if (!svg.includes("viewBox=") || svg.includes("<image"))
    throw new Error(`Fixture ${fixture.name} is not self-contained vector SVG`);
  const path = join(fixtureDir, `${fixture.name}.svg`);
  let current = null;
  try {
    current = normalizeLineEndings(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== svg) {
    changed = true;
    if (process.argv.includes("--check")) {
      console.error(`MathJax fixture is stale: ${path}`);
    } else {
      writeFileSync(path, svg, "utf8");
      console.log(`Wrote ${path}`);
    }
  }
}
if (process.argv.includes("--check") && changed) process.exit(1);
console.log(
  `MathJax tex-svg 3.2.2 fixtures verified (fontCache:none, count=${fixtures.length}).`,
);
