import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const browserCandidates = [
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
  process.env["PROGRAMFILES(X86)"] &&
    join(
      process.env["PROGRAMFILES(X86)"],
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
].filter(Boolean);
const browserExecutable = browserCandidates.find(existsSync);
if (!browserExecutable) {
  throw new Error(
    "No Chromium browser found. Set PW_CHROMIUM or install Playwright Chromium, Chrome, or Edge.",
  );
}

const evidenceIndex = process.argv.indexOf("--evidence");
const evidenceDir =
  evidenceIndex >= 0 ? process.argv[evidenceIndex + 1]?.trim() : "";
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><path d="M12 40h72" stroke="#2563eb" stroke-width="8"/><path d="M78 18l30 22-30 22" fill="none" stroke="#172033" stroke-width="8"/></svg>';
const symbolBundle = {
  symbol: {
    id: "browser-symbol-1",
    name: "浏览器验证符号",
    latexCommand: "\\mysymbol",
  },
  svg: {
    mimeType: "image/svg+xml",
    dataBase64: Buffer.from(svg).toString("base64"),
  },
};

const browser = await chromium.launch({
  executablePath: browserExecutable,
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript((bundle) => {
    localStorage.setItem(
      "latexsnipper.custom-symbols.v1",
      JSON.stringify([bundle]),
    );
  }, symbolBundle);
  const page = await context.newPage();
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
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });

  const categoryOptions = page.locator(
    "#categoryDropdown .custom-select-option",
  );
  await categoryOptions.first().waitFor({ state: "attached" });
  assert.ok(
    (await categoryOptions.count()) > 2,
    "built-in formula categories must remain available beside custom symbols",
  );

  const sidebarTrigger = page.locator("#sidebarTrigger");
  const sidebarTriggerBox = await sidebarTrigger.boundingBox();
  assert.ok(sidebarTriggerBox, "formula-library launcher must be visible");
  assert.equal(
    await sidebarTrigger.evaluate((trigger) => {
      const bounds = trigger.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return trigger === hit || trigger.contains(hit);
    }),
    true,
    "formula-library launcher must own its center hit target",
  );
  await page.mouse.click(
    sidebarTriggerBox.x + sidebarTriggerBox.width / 2,
    sidebarTriggerBox.y + sidebarTriggerBox.height / 2,
  );
  await page.locator("#sidebarPanel.open").waitFor();
  await page.locator("#categorySelect .custom-select-trigger").click();
  const customOption = page.locator(
    '#categoryDropdown .custom-select-option[data-value="__custom_symbols__"]',
  );
  assert.match((await customOption.textContent()) || "", /自定义符号（1）/);
  await customOption.click();

  const customItem = page.locator("#libraryGrid .custom-symbol-library-item");
  await customItem.waitFor({ state: "visible" });
  assert.equal(await customItem.count(), 1);
  assert.equal(
    await customItem.locator("img").evaluate((image) => image.complete),
    true,
  );
  assert.ok(
    await customItem
      .locator("img")
      .evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0),
    "saved custom symbol must decode into a visible library thumbnail",
  );
  await customItem.click();
  assert.match(
    await page.evaluate(() => window.__app?.editor?.getLatex?.() || ""),
    /\\mysymbol/,
  );

  await page.evaluate(async () => {
    const latex = String.raw`\mysymbol\frac12=`;
    window.__app.editor.setLatex(latex);
    await window.__app.editor.updatePreview(latex);
  });
  const preview = page.locator("#previewHost");
  const renderedCustomSymbol = preview.locator(
    '[class*="latexsnipper-custom-symbol-"]',
  );
  await renderedCustomSymbol.waitFor();
  assert.match(
    await renderedCustomSymbol.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
    /^url\("data:image\/svg\+xml;base64,/,
    "mixed-formula preview must paint the saved SVG symbol",
  );
  assert.equal(
    await renderedCustomSymbol.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgba(0, 0, 0, 0)",
    "the Temml rule placeholder must not cover the saved SVG with black",
  );
  assert.equal(await preview.locator("mfrac").count(), 1);
  assert.doesNotMatch(await preview.innerText(), /\\mysymbol/);

  if (evidenceDir) {
    await page.screenshot({
      path: join(evidenceDir, "custom-symbol-library-and-mixed-formula.png"),
      fullPage: true,
    });
  }

  await page.locator("#categorySelect .custom-select-trigger").click();
  await page
    .locator('#categoryDropdown .custom-select-option[data-value="greek"]')
    .click();
  assert.ok(
    (await page.locator("#libraryGrid .formula-item").count()) > 1,
    "switching back from custom symbols must restore built-in formulas",
  );
  assert.equal(
    await page.locator("#libraryGrid .custom-symbol-library-item").count(),
    0,
  );

  if (evidenceDir) {
    await page.screenshot({
      path: join(evidenceDir, "formula-library-category-recovery.png"),
      fullPage: true,
    });
  }
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(failedFontRequests, []);
  console.log(
    "PASS: saved custom symbol thumbnail, library category recovery, MathLive registration, and mixed-formula Temml preview.",
  );
} finally {
  await browser.close();
}
