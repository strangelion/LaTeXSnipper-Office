// Real Chromium UI checks. Host API fixtures do NOT constitute Office.js/pipe acceptance.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const executablePath = [
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
]
  .filter(Boolean)
  .find(existsSync);
if (!executablePath) throw new Error("No Chromium browser is available");
const evidenceDir = "output/playwright/office-selection-conversion";
mkdirSync(evidenceDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__app?.editor));
  await page
    .getByRole("button", { name: "Office", exact: true })
    .first()
    .click();
  await page.locator("#officeWorkspaceSelectionLatex").click();
  await page.waitForFunction(() =>
    document.body.textContent.includes(
      "请先选择已连接且有文档标识的 Word 宿主",
    ),
  );

  async function openPreview(fail = false) {
    await page.evaluate(async (fail) => {
      const workflow = await import("/services/office-selection-conversion.js");
      const plan = {
        target: {
          host: "word",
          sessionId: "fixture",
          documentContext: "fixture-doc",
        },
        items: [
          {
            sourceText: String.raw`\frac{a}{b}`,
            normalizedLatex: String.raw`\frac{a}{b}`,
            status: "converted",
            omml: "<m:oMath/>",
            sourceHash: "fixture-only",
            locator: { kind: "wordRange", start: 0, end: 11 },
          },
        ],
      };
      window.__selectionTestAnswer = workflow.confirmSelectionConversion(
        plan,
        fail
          ? () => Promise.reject(new Error("Injected preview failure"))
          : (latex) => window.__app.editor.createPreviewNode(latex, false),
      );
    }, fail);
  }
  await openPreview();
  const dialog = page.locator("dialog.office-selection-dialog");
  await dialog.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector(".office-selection-dialog button:last-child")
        ?.disabled,
  );
  assert.ok(
    await dialog
      .locator(
        ".office-selection-preview svg, .office-selection-preview math, .office-selection-preview .katex",
      )
      .count(),
  );
  await dialog.getByRole("button", { name: "取消，保留原文" }).click();
  assert.equal(await page.evaluate(() => window.__selectionTestAnswer), false);
  await openPreview();
  await page.waitForFunction(
    () =>
      !document.querySelector(".office-selection-dialog button:last-child")
        ?.disabled,
  );
  await dialog.getByRole("button", { name: "确认替换这一条" }).click();
  assert.equal(await page.evaluate(() => window.__selectionTestAnswer), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview();
  await page.waitForFunction(
    () =>
      !document.querySelector(".office-selection-dialog button:last-child")
        ?.disabled,
  );
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: join(evidenceDir, "narrow-preview.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__selectionTestAnswer), false);
  await openPreview(true);
  await dialog
    .getByText("预览失败，不能确认替换")
    .waitFor({ state: "visible" });
  assert.equal(
    await dialog.getByRole("button", { name: "确认替换这一条" }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "取消，保留原文" }).click();
  assert.equal(await page.evaluate(() => window.__selectionTestAnswer), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser renders real formula preview; confirm/cancel/Escape, failed-preview guard and 390px layout pass. Host writes excluded.",
  );
} finally {
  await browser.close();
}
