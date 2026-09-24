import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const evidenceIndex = process.argv.indexOf("--evidence");
const evidenceDir =
  evidenceIndex >= 0 ? process.argv[evidenceIndex + 1]?.trim() : "";
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
const evidencePath = (environmentName, filename) =>
  process.env[environmentName] ||
  (evidenceDir ? join(evidenceDir, filename) : "");

const require = createRequire(import.meta.url);
const playwrightRoot = process.env.PW_CORE || "playwright-core";
const { chromium } = require(playwrightRoot);
const chromiumPath = process.env.PW_CHROMIUM || chromium.executablePath();

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
      !response.ok() &&
      response.status() !== 304
    ) {
      failedFontRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  const drawingSource = page.locator("#drawingSource");
  const drawingSourceEditor = page.locator(
    "#drawingSourceCodeEditor .cm-content",
  );
  const fillDrawingSource = async (source) => {
    await drawingSourceEditor.waitFor({ state: "visible" });
    await drawingSourceEditor.fill(source);
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#drawingSource")?.value === expected,
      source,
    );
  };

  await page.locator("#drawingModeTab").click();
  await page.locator('[data-drawing-language="svg_source"]').first().click();
  await page.locator("#drawingVisualModeBtn").click();
  const svgAutoPreview = page.locator("#drawingAutoPreview");
  if (await svgAutoPreview.isChecked()) await svgAutoPreview.setChecked(false);
  const svgObjectCountBefore = await page
    .locator("#drawingVisualCanvas [data-drawing-object]")
    .count();
  await page.locator('[data-drawing-canvas-tool="freehand"]').click();
  const svgCanvasBox = await page.locator("#drawingVisualCanvas").boundingBox();
  await page.mouse.move(
    svgCanvasBox.x + 45,
    svgCanvasBox.y + svgCanvasBox.height * 0.55,
  );
  await page.mouse.down();
  await page.mouse.move(
    svgCanvasBox.x + svgCanvasBox.width - 45,
    svgCanvasBox.y + svgCanvasBox.height * 0.42,
    { steps: 28 },
  );
  await page.mouse.up();
  assert.equal(
    await page.locator("#drawingCanvasUndo").isEnabled(),
    true,
    "freehand must produce an undoable object",
  );
  assert.equal(
    await page.locator("#drawingVisualCanvas [data-drawing-object]").count(),
    svgObjectCountBefore + 1,
  );
  assert.match(await page.locator("#drawingSource").inputValue(), /<path\b/);
  assert.equal(
    await page
      .locator("#drawingObjectManagerList .drawing-object-manager-row")
      .count(),
    svgObjectCountBefore + 1,
  );
  await page.locator("#drawingCanvasUndo").click();
  assert.equal(
    await page.locator("#drawingVisualCanvas [data-drawing-object]").count(),
    svgObjectCountBefore,
  );
  await page.locator("#drawingCanvasRedo").click();
  assert.equal(
    await page.locator("#drawingVisualCanvas [data-drawing-object]").count(),
    svgObjectCountBefore + 1,
  );
  const selectedSvgRow = page
    .locator(
      "#drawingObjectManagerList .drawing-object-manager-row.is-selected",
    )
    .first();
  await selectedSvgRow.getByTitle("锁定对象位置和尺寸").click();
  assert.equal(
    await page
      .locator("#drawingVisualCanvas .drawing-visual-object.is-locked")
      .count(),
    1,
  );
  await selectedSvgRow.getByTitle("允许编辑对象").click();
  const svgScreenshot = evidencePath(
    "DRAWING_SVG_SCREENSHOT",
    "svg-professional.png",
  );
  if (svgScreenshot) {
    await page.screenshot({
      path: svgScreenshot,
      fullPage: true,
    });
  }

  await page.locator('[data-drawing-language="mermaid"]').first().click();
  await page.locator("#drawingVisualModeBtn").click();
  const firstMermaidNode = page
    .locator("#drawingVisualCanvas [data-drawing-object]")
    .filter({ hasText: /\S/ })
    .first();
  await firstMermaidNode.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    node.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }),
    );
  });
  await page.locator(".drawing-inline-text-editor").fill("Start edited");
  await page.locator(".drawing-inline-text-editor").press("Enter");
  assert.match(
    await page.locator("#drawingSource").inputValue(),
    /Start edited/,
  );
  const canvasBox = await page.locator("#drawingVisualCanvas").boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2,
  );
  await page.mouse.wheel(0, -480);
  const viewBoxBeforePan = await page
    .locator("#drawingVisualCanvas svg")
    .getAttribute("viewBox");
  await page.locator('[data-drawing-canvas-tool="pan"]').click();
  await page.mouse.move(canvasBox.x + 24, canvasBox.y + 24);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 150, canvasBox.y + 90);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const viewBoxAfter = await page
    .locator("#drawingVisualCanvas svg")
    .getAttribute("viewBox");
  assert.notEqual(viewBoxAfter, viewBoxBeforePan);
  await page.locator("#drawingCanvasFit").click();
  await page.locator("#drawingSourceModeBtn").click();
  assert.equal(
    await page.locator("#drawingSourceLanguage").textContent(),
    "Mermaid",
  );
  assert.equal(await page.locator(".cm-lineNumbers").count(), 1);
  await fillDrawingSource(
    "flowchart LR\n  A[输入] --> B{验证}\n  B -->|通过| C[Office]\n  B -->|失败| D[诊断]",
  );
  assert.match(
    await page.locator("#drawingSourceDiffStatus").textContent(),
    /修改/,
  );
  await page.locator("#drawingSourceSnapshot").click();
  assert.equal(
    await page.locator("#drawingSourceDiffStatus").textContent(),
    "与基线一致",
  );
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 20_000 });
  const fittedPreview = await page.evaluate(() => {
    const svg = document.querySelector("#drawingPreview > svg");
    if (!svg) return null;
    const box = svg.getBBox();
    const viewBox = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      viewBox,
      width: svg.getAttribute("width"),
      height: svg.getAttribute("height"),
    };
  });
  assert.ok(fittedPreview, "compiled preview must expose a root SVG");
  assert.equal(fittedPreview.viewBox.length, 4);
  assert.equal(
    fittedPreview.viewBox.every(Number.isFinite),
    true,
    "compiled preview must expose a numeric fitted viewBox",
  );
  assert.equal(fittedPreview.width, null);
  assert.equal(fittedPreview.height, null);
  const [viewX, viewY, viewWidth, viewHeight] = fittedPreview.viewBox;
  const contentRight = fittedPreview.box.x + fittedPreview.box.width;
  const contentBottom = fittedPreview.box.y + fittedPreview.box.height;
  assert.ok(viewX <= fittedPreview.box.x && viewY <= fittedPreview.box.y);
  assert.ok(viewX + viewWidth >= contentRight);
  assert.ok(viewY + viewHeight >= contentBottom);
  assert.ok(
    viewWidth < fittedPreview.box.width * 1.35 &&
      viewHeight < fittedPreview.box.height * 1.35,
    `compiled preview must not retain the authoring canvas as Office image whitespace: ${JSON.stringify(fittedPreview)}`,
  );
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
  const excelImportButton = page.locator("#drawingPlotImportExcel");
  await excelImportButton.waitFor({ state: "visible" });
  assert.equal(
    (await excelImportButton.textContent())?.trim(),
    "从 Excel 读取当前选区",
  );
  const [plotDataBox, excelImportBox] = await Promise.all([
    page.locator("#drawingPlotData").boundingBox(),
    excelImportButton.boundingBox(),
  ]);
  assert.ok(
    plotDataBox && excelImportBox,
    "Excel import controls must be laid out",
  );
  assert.ok(
    excelImportBox.x >= plotDataBox.x + plotDataBox.width,
    "Excel import button must not overlap the data table",
  );
  await excelImportButton.click();
  await page
    .locator("#drawingCompileStatus")
    .filter({ hasText: /读取 Excel 选区失败|Excel 选区读取仅在桌面应用中可用/ })
    .waitFor({ timeout: 5_000 });
  assert.equal(await excelImportButton.isEnabled(), true);
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
  const fittedPgfSource = await page.locator("#drawingSource").inputValue();
  assert.match(fittedPgfSource, /exp\(/);
  assert.match(
    fittedPgfSource,
    /at=\{\(axis description cs:0\.5,-0\.16\)\}, anchor=north/,
    "PGFPlots legend must be laid out below the plot instead of covering data",
  );
  await compilePgf("exponential table fitting");
  const pgfScreenshot = evidencePath("DRAWING_PGF_SCREENSHOT", "pgfplots.png");
  if (pgfScreenshot) {
    await page.locator("#drawingPreview").screenshot({
      path: pgfScreenshot,
    });
  }

  await page
    .locator('[data-drawing-language="tikz"]:not([data-drawing-profile])')
    .click();
  assert.equal(await page.locator("#drawingPreview svg").count(), 0);
  await page.locator("#drawingSourceModeBtn").click();
  await fillDrawingSource(
    String.raw`\draw[->, thick] (0,0) -- (3,0) node[right] {$x$};
\draw[->, thick] (0,0) -- (0,2) node[above] {$y$};`,
  );
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 45_000 });
  assert.doesNotMatch(
    await page.locator("#drawingCompileStatus").textContent(),
    /TikZ 编译失败/,
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#drawingModeTab").click();
  await page
    .locator('[data-drawing-language="tikz"]:not([data-drawing-profile])')
    .click();
  if (
    !(
      await page.locator("#drawingVisualModeBtn").getAttribute("class")
    )?.includes("active")
  ) {
    await page.locator("#drawingVisualModeBtn").click();
  }
  await page.locator('[data-drawing-profile-template="chinese"]').click();
  const chineseTikzSource = await page.locator("#drawingSource").inputValue();
  assert.match(chineseTikzSource, /中文 TikZ 流程图/);
  assert.match(chineseTikzSource, /输入/);
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 20_000 });
  assert.match(
    await page.locator("#drawingPreview").innerHTML(),
    /中文 TikZ 流程图/,
  );
  assert.doesNotMatch(
    await page.locator("#drawingCompileStatus").textContent(),
    /编译失败|CJK/,
  );
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
  const drawingScreenshot = evidencePath("DRAWING_SCREENSHOT", "tikz-cjk.png");
  if (drawingScreenshot) {
    await page.screenshot({
      path: drawingScreenshot,
      fullPage: true,
    });
  }

  if ((await page.locator("html").getAttribute("data-theme")) !== "dark") {
    await page.locator("#themeToggle").click();
  }
  assert.equal(
    await page.locator("html").getAttribute("data-theme"),
    "dark",
    "theme toggle must switch the complete drawing workspace to dark mode",
  );
  const darkThemeContrast = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      const style = element ? getComputedStyle(element) : null;
      return style
        ? {
            color: style.color,
            backgroundColor: style.backgroundColor,
            opacity: style.opacity,
          }
        : null;
    };
    return {
      nav: read("#drawingModeTab"),
      themeToggle: read("#themeToggle"),
      workbench: read("#drawingVisualEditor"),
    };
  });
  for (const [name, style] of Object.entries(darkThemeContrast)) {
    assert.ok(style, `${name} must remain present in dark mode`);
    assert.notEqual(
      style.color,
      style.backgroundColor,
      `${name} foreground must remain distinguishable in dark mode`,
    );
    assert.notEqual(style.opacity, "0", `${name} must remain visible`);
  }
  const darkScreenshot = evidencePath(
    "DRAWING_DARK_SCREENSHOT",
    "dark-drawing.png",
  );
  if (darkScreenshot) {
    await page.screenshot({
      path: darkScreenshot,
      fullPage: true,
    });
  }

  const relevantErrors = browserErrors.filter(
    (message) => !/TAURI|invoke|__TAURI_INTERNALS__/i.test(message),
  );
  assert.deepEqual(relevantErrors, []);
  assert.deepEqual(failedFontRequests, []);
  console.log(
    "Drawing workbench real-browser smoke OK: professional SVG freehand/history/layers, Mermaid navigation/inline edit, fitted Office bounds, safety, PNG raster, Excel-to-PGF entry, every PGF preset, fitting, fonts, stale-preview reset, TikZ CJK, LaTeX object, dark theme contrast",
  );
} finally {
  await browser.close();
}
