import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const candidates = [
  process.env.PW_CHROMIUM,
  chromium.executablePath(),
  process.env.PROGRAMFILES &&
    join(
      process.env.PROGRAMFILES,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  process.env.PROGRAMFILES &&
    join(
      process.env.PROGRAMFILES,
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
].filter(Boolean);
const executablePath = candidates.find(existsSync);
if (!executablePath) throw new Error("No Chromium browser is available");

const evidenceIndex = process.argv.indexOf("--evidence");
const evidenceDir =
  evidenceIndex >= 0 ? process.argv[evidenceIndex + 1]?.trim() : "";
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  const center = page.locator("details.formula-style-center");
  await center.evaluate((element) => {
    element.open = true;
  });

  await page.locator("#formulaStylePreset").selectOption("builtin-inline");
  const inlineRender = await page.evaluate(() =>
    window.__app._renderLatexSvg(String.raw`x^2+\frac12`, false),
  );

  await page.locator("#formulaStylePreset").selectOption("builtin-teaching");
  assert.equal(
    await page
      .locator('input[name="formulaInsertMode"][value="display"]')
      .isChecked(),
    true,
    "style preset must synchronize the formula insertion mode",
  );
  await page.locator("#formulaStyleMathVariant").selectOption("roman");
  await page.locator("#formulaStyleColor").evaluate((element) => {
    element.value = "#2563eb";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#formulaStyleFontSize").fill("24");
  await page.locator("#formulaStyleFontSize").press("Tab");

  const styledRender = await page.evaluate(() =>
    window.__app._renderLatexSvg(String.raw`x^2+\frac12`, true),
  );
  assert.equal(styledRender.styleProfile.math.fontSizePt, 24);
  assert.equal(styledRender.styleProfile.math.mathVariant, "roman");
  assert.equal(styledRender.styleProfile.math.color, "#2563EB");
  assert.match(styledRender.svg, /data-latexsnipper-style-profile=/);
  assert.match(styledRender.svg, /color="#2563EB"/);
  assert.ok(
    styledRender.widthPt > inlineRender.widthPt,
    "larger style must change actual SVG output dimensions",
  );

  const presentation = await page.evaluate(() =>
    window.__app.currentFormulaPresentation(),
  );
  assert.equal(presentation.color, "#2563EB");
  assert.equal(presentation.fontScale, 2.4);
  assert.equal(presentation.styleProfile.output.strategy, "fixed");

  await page.locator("#formulaStyleName").fill("浏览器验证样式");
  await page.locator("#formulaStyleSaveAs").click();
  assert.match(
    await page.locator("#formulaStyleStatus").textContent(),
    /已另存为/,
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("latexsnipper.formula-style.v1")),
  );
  assert.equal(saved.profiles.length, 1);
  assert.equal(saved.profiles[0].name, "浏览器验证样式");
  assert.equal(saved.profiles[0].math.color, "#2563EB");

  await page.evaluate(async () => {
    const latex = String.raw`E=mc^2`;
    window.__app.editor.setLatex(latex);
    await window.__app.editor.updatePreview(latex);
  });
  if (evidenceDir) {
    await center.screenshot({
      path: join(evidenceDir, "formula-style-center.png"),
    });
  }

  assert.deepEqual(browserErrors, []);
  console.log(
    "PASS: formula style preset, actual SVG dimensions/color, Office snapshot, persistence, and UI preview.",
  );
} finally {
  await browser.close();
}
