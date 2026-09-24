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
  const page = await browser.newPage({
    viewport: { width: 1365, height: 920 },
  });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  const editor = page.locator("#formulaSourceEditor .cm-content");
  await editor.waitFor({ state: "visible" });
  const latex = String.raw`% wave equation
\nabla^{2}u-\frac{1}{c^{2}}\frac{\partial^{2}u}{\partial t_{1}^{2}}=0`;
  await editor.fill(latex);
  await page.waitForFunction(
    (expected) => document.querySelector("#latexSource")?.value === expected,
    latex,
  );

  assert.equal(
    await page.locator("#latexSource").inputValue(),
    latex,
    "CodeMirror did not synchronize the compatibility textarea",
  );
  assert.ok(
    (await page.locator(".formula-source-superscript").count()) >= 3,
    "stacked superscript arguments were not highlighted",
  );
  assert.ok(
    (await page.locator(".formula-source-subscript").count()) >= 1,
    "subscript arguments were not highlighted",
  );
  assert.ok(
    (await page.locator('[class*="formula-source-brace-depth-"]').count()) >=
      10,
    "nested formula braces were not depth-highlighted",
  );

  const structuralColors = await page
    .locator(
      '[class*="formula-source-brace-depth-"], .formula-source-superscript, .formula-source-subscript',
    )
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => getComputedStyle(element).color)),
    ]);
  assert.ok(
    structuralColors.length >= 4,
    `expected at least four structural colours, observed ${structuralColors.join(", ")}`,
  );

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const darkColors = await page
    .locator(
      ".formula-source-brace-depth-0, .formula-source-superscript, .formula-source-subscript",
    )
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).color),
    );
  assert.equal(
    new Set(darkColors).size,
    3,
    "dark theme collapsed structural colours",
  );

  if (evidenceDir) {
    await page
      .locator(".editor-main .card")
      .first()
      .screenshot({
        path: join(evidenceDir, "formula-source-structural-highlighting.png"),
      });
  }

  await page.evaluate(() => {
    const textarea = document.querySelector("#latexSource");
    textarea.value = String.raw`x_{i}^{2}+\sqrt{y}`;
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#formulaSourceEditor .cm-content")
        ?.textContent === String.raw`x_{i}^{2}+\sqrt{y}`,
  );

  assert.deepEqual(browserErrors, []);
  console.log(
    "PASS: LaTeX source commands, nested groups, superscripts and subscripts use distinct theme-aware colours and remain synchronized.",
  );
} finally {
  await browser.close();
}
