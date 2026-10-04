import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const executablePath = [
  process.env.PW_CHROMIUM,
  chromium.executablePath(),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
]
  .filter(Boolean)
  .find(existsSync);
assert.ok(executablePath, "No Chromium browser is available");
const evidenceIndex = process.argv.indexOf("--evidence");
const directory =
  evidenceIndex < 0
    ? "output/playwright/tex-font-export"
    : process.argv[evidenceIndex + 1];
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__app?.drawingWorkspace));
  await page.locator("#drawingModeTab").click();
  await page
    .locator('[data-drawing-language="tikz"][data-drawing-profile="pgf_plots"]')
    .click();
  await page.locator("#drawingSourceModeBtn").click();
  await page.waitForFunction(
    () => !document.querySelector("#drawingCompileBtn").disabled,
    null,
    { timeout: 90_000 },
  );
  await page.locator("#drawingSourceCodeEditor .cm-content")
    .fill(String.raw`\begin{axis}[grid=major,xlabel={$x$},ylabel={$f(x)$}]
\addplot[blue,thick,domain=-3:3,samples=100]{x^2};
\end{axis}`);
  await page.locator("#drawingCompileBtn").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#drawingPreview svg[data-tex-glyph-outlines]") &&
      !document.querySelector("#drawingCompileBtn").disabled,
    null,
    { timeout: 90_000 },
  );
  const exported = await page.evaluate(async () => {
    // Export the compile result, not UI-only attributes on the preview element.
    const result = await window.__app.drawingWorkspace.compile();
    if (!result?.svg)
      throw new Error("Native TeX compile returned no artifact");
    const svg = document.querySelector("#drawingPreview svg");
    const values = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const bbox = svg.getBBox();
    const { rasterizeDrawingSvg } =
      await import("/features/drawing/workspace.js");
    return {
      svg: result.svg,
      coreValidated: result.success === true && !result.localPreviewOnly,
      glyphs: Number(svg.getAttribute("data-tex-glyph-outlines")),
      textNodes: svg.querySelectorAll("text,tspan").length,
      fonts: [
        ...new Set(
          [...svg.querySelectorAll("[data-tex-font]")].map((e) =>
            e.getAttribute("data-tex-font"),
          ),
        ),
      ],
      viewBox: values,
      inkWidthRatio: bbox.width / values[2],
      inkHeightRatio: bbox.height / values[3],
      png: await rasterizeDrawingSvg(result.svg, values[2], values[3]),
    };
  });
  assert.equal(
    exported.textNodes,
    0,
    "portable native TeX SVG still depends on fonts",
  );
  assert.ok(exported.glyphs >= 20);
  for (const font of ["cmr10", "cmsy10", "cmmi10"])
    assert.ok(exported.fonts.includes(font));
  assert.ok(exported.inkWidthRatio > 0.8 && exported.inkHeightRatio > 0.8);
  assert.doesNotMatch(exported.svg, /[\uE000-\uF8FF]|@font-face|\.woff2/);
  assert.doesNotMatch(
    exported.svg,
    /(?:fill|stroke|stop-color)=["']currentcolor["']/i,
  );
  writeFileSync(join(directory, "pgfplots-font-independent.svg"), exported.svg);
  writeFileSync(
    join(directory, "pgfplots-font-independent.png"),
    Buffer.from(exported.png.split(",")[1], "base64"),
  );
  await page
    .locator("#drawingPreview")
    .screenshot({ path: join(directory, "pgfplots-preview.png") });
  const { svg, png, ...report } = exported;
  console.log(
    JSON.stringify(
      {
        pass: true,
        runtime:
          "real Chromium, native TeX SVG and standalone SVG-to-PNG export",
        ...report,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
