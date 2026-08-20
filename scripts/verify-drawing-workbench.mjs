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
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  await page.locator("#drawingModeTab").click();
  await page.locator('[data-drawing-language="mermaid"]').first().click();
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
  console.log(
    "Drawing workbench real-browser smoke OK: Mermaid safety, stale-preview reset, TikZ, LaTeX object",
  );
} finally {
  await browser.close();
}
