import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightRoot =
  process.env.PW_CORE ||
  "C:/Users/WangWenXuan/AppData/Local/Temp/pwtest/node_modules/playwright-core";
const chromiumPath =
  process.env.PW_CHROMIUM ||
  "C:/Users/WangWenXuan/AppData/Local/ms-playwright/chromium-1237/chrome-win64/chrome.exe";
const { chromium } = require(playwrightRoot);

const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const browserErrors = [];
  const failedFontRequests = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (/mathlive-fonts|KaTeX_.*\.woff2/i.test(request.url())) {
      failedFontRequests.push(
        `${request.url()} ${request.failure()?.errorText}`,
      );
    }
  });
  page.on("response", (response) => {
    if (
      /mathlive-fonts|KaTeX_.*\.woff2/i.test(response.url()) &&
      !response.ok()
    ) {
      failedFontRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  await page.locator("#drawingModeTab").click();
  await page.locator('[data-drawing-language="mermaid"]').first().click();
  await page.locator("#drawingVisualModeBtn").click();
  const firstMermaidNode = page
    .locator("#drawingVisualCanvas [data-drawing-object]")
    .first();
  await firstMermaidNode.dblclick();
  await page.locator(".drawing-inline-text-editor").fill("Start edited");
  await page.locator(".drawing-inline-text-editor").press("Enter");
  assert.match(
    await page.locator("#drawingSource").inputValue(),
    /Start edited/,
  );
  const canvasBox = await page.locator("#drawingVisualCanvas").boundingBox();
  const viewBoxBefore = await page
    .locator("#drawingVisualCanvas svg")
    .getAttribute("viewBox");
  await page.mouse.move(canvasBox.x + 24, canvasBox.y + canvasBox.height - 24);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 150, canvasBox.y + canvasBox.height - 90);
  await page.mouse.up();
  const viewBoxAfter = await page
    .locator("#drawingVisualCanvas svg")
    .getAttribute("viewBox");
  assert.notEqual(viewBoxAfter, viewBoxBefore);
  await page.locator("#drawingCanvasFit").click();
  await page.locator("#drawingSourceModeBtn").click();
  await page
    .locator("#drawingSource")
    .fill(
      "flowchart LR\n  A[输入] --> B{验证}\n  B -->|通过| C[Office]\n  B -->|失败| D[诊断]",
    );
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 20_000 });
  const mermaidSvg = await page.locator("#drawingPreview").innerHTML();
  assert.doesNotMatch(mermaidSvg, /foreignObject|1999\/xhtml/i);
  assert.match(
    await page.locator("#drawingPreviewSource").textContent(),
    /Mermaid.*(?:本地待校验|Core 已验证)/,
  );
  assert.doesNotMatch(
    await page.locator("#drawingCompileStatus").textContent(),
    /DRAWING_REMOTE_INCLUDE_FORBIDDEN/,
  );
  const png = await page.evaluate(async () => {
    const { rasterizeDrawingSvg } =
      await import("/features/drawing/workspace.js");
    const svg = document.querySelector("#drawingPreview svg")?.outerHTML || "";
    return rasterizeDrawingSvg(svg, 240, 144);
  });
  assert.match(png, /^data:image\/png;base64,iVBOR/);

  await page
    .locator('[data-drawing-language="tikz"][data-drawing-profile="pgf_plots"]')
    .click();
  await page.locator("#drawingVisualModeBtn").click();
  const autoPreview = page.locator("#drawingAutoPreview");
  if (await autoPreview.isChecked()) await autoPreview.setChecked(false);
  const compilePgf = async (name) => {
    await page.locator("#drawingCompileBtn").click();
    try {
      await page.locator("#drawingPreview svg").waitFor({ timeout: 45_000 });
    } catch (error) {
      const status = await page.locator("#drawingCompileStatus").textContent();
      const source = await page.locator("#drawingSource").inputValue();
      throw new Error(
        `PGFPlots ${name} real-browser render failed: ${status}\n${source}`,
        { cause: error },
      );
    }
    assert.doesNotMatch(
      await page.locator("#drawingCompileStatus").textContent(),
      /编译失败/,
      name,
    );
  };
  const presetButtons = page.locator("[data-plot-expression]");
  for (let index = 0; index < (await presetButtons.count()); index += 1) {
    const preset = presetButtons.nth(index);
    const expression = await preset.getAttribute("data-plot-expression");
    await preset.click();
    await page.locator("#drawingPlotApply").click();
    await compilePgf(expression);
  }
  await page.locator("#drawingPlotData").fill("x,y\n0,2\n1,4\n2,8\n3,16");
  await page.locator("#drawingPlotFitModel .custom-select-trigger").click();
  await page
    .locator(
      '#drawingPlotFitModel .custom-select-option[data-value="exponential"]',
    )
    .click();
  await page.locator("#drawingPlotFit").click();
  await page
    .locator('#drawingPlotFitStatus[data-state="success"]')
    .waitFor({ timeout: 10_000 });
  assert.match(
    await page.locator("#drawingSource").inputValue(),
    /table\[row sep=\\\\\]/,
  );
  assert.match(await page.locator("#drawingSource").inputValue(), /exp\(/);
  await compilePgf("exponential table fitting");

  await page
    .locator('[data-drawing-language="tikz"]:not([data-drawing-profile])')
    .click();
  assert.equal(await page.locator("#drawingPreview svg").count(), 0);
  await page.locator("#drawingSourceModeBtn").click();
  await page.locator("#drawingSource").fill(
    String.raw`\draw[->, thick] (0,0) -- (3,0) node[right] {$x$};
\draw[->, thick] (0,0) -- (0,2) node[above] {$y$};`,
  );
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 45_000 });
  assert.doesNotMatch(
    await page.locator("#drawingCompileStatus").textContent(),
    /TikZ 编译失败/,
  );

  await page.locator("#drawingVisualModeBtn").click();
  await page
    .locator("#drawingTikzLatex")
    .fill(String.raw`\frac{a}{b}=\sqrt{x}`);
  await page.locator("#drawingTikzLatexAdd").click();
  await page.getByText("公式已作为独立矢量对象加入", { exact: false }).waitFor({
    timeout: 15_000,
  });
  assert.equal(
    (await page.locator("#drawingVisualCanvas [data-drawing-object]").count()) >
      0,
    true,
  );
  if (process.env.DRAWING_SCREENSHOT) {
    await page.screenshot({
      path: process.env.DRAWING_SCREENSHOT,
      fullPage: true,
    });
  }

  const relevantErrors = browserErrors.filter(
    (message) => !/TAURI|invoke|__TAURI_INTERNALS__/i.test(message),
  );
  assert.deepEqual(relevantErrors, []);
  assert.deepEqual(failedFontRequests, []);
  console.log(
    "Drawing workbench real-browser smoke OK: Mermaid navigation/inline edit, safety, PNG raster, every PGF preset, fitting, fonts, stale-preview reset, TikZ, LaTeX object",
  );
} finally {
  await browser.close();
}
