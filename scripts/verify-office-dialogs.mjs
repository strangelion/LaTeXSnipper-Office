// Real browser layout/lifecycle checks; Office callbacks are fixtures, not COM proof.
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
if (!executablePath) throw new Error("No Chromium browser is available");
const baseline = process.argv.includes("--baseline");
const output = "output/playwright/office-dialogs";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__app?.editor));
  async function format(delayed = false) {
    await page.evaluate(async (delayed) => {
      const { openFormatConversionDialog } =
        await import("/services/office-format-conversion.js");
      window.__dialogDisposed = 0;
      window.__dialogAnswer = openFormatConversionDialog({
        context: {
          native: true,
          connected: true,
          host: "word",
          sessionId: "fixture",
          documentContext: "fixture-document",
          documentTitle: "Test.docx",
          editor: true,
          engine: true,
        },
        prepare: async () => {
          if (delayed) await new Promise((resolve) => setTimeout(resolve, 150));
          return { latex: "x^2" };
        },
        renderPreview: async () => document.createTextNode("Preview"),
        dispose: async () => {
          window.__dialogDisposed++;
        },
      });
    }, delayed);
  }
  async function batch() {
    await page.evaluate(async () => {
      const { confirmOfficeBatch } =
        await import("/services/office-batch-runner.js");
      window.__batchAnswer = confirmOfficeBatch({
        target: { documentContext: "fixture-document" },
        items: Array.from({ length: 4 }, () => ({
          status: "converted",
          sourceText: "$x$",
        })),
      });
    });
  }
  await format();
  await batch();
  const initial = await page.evaluate(() =>
    [...document.querySelectorAll("dialog[open]")].map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        className: dialog.className,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }),
  );
  writeFileSync(
    join(output, baseline ? "baseline.json" : "initial.json"),
    JSON.stringify(initial, null, 2),
  );
  await page.screenshot({
    path: join(output, baseline ? "baseline.png" : "confirmation.png"),
  });
  if (!baseline) {
    assert.equal(initial.length, 1, "Conversion dialogs must not stack");
    assert.ok(
      Math.abs(initial[0].x + initial[0].width / 2 - 640) <= 1,
      "Confirmation is not centered",
    );
    assert.ok(initial[0].y > 0);
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "取消，保留原文",
    );
    await page.mouse.click(4, 4);
    assert.equal(await page.evaluate(() => window.__batchAnswer), false);
    assert.equal(await page.evaluate(() => window.__dialogAnswer), null);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      for (let repeat = 0; repeat < 10; repeat++) {
        await format();
        const box = await page.locator("dialog[open]").boundingBox();
        const footer = await page
          .locator("dialog[open] .conversion-actions")
          .boundingBox();
        assert.ok(box.y >= 11 && box.y + box.height <= viewport.height - 11);
        assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) <= 1);
        assert.ok(
          footer.y >= box.y && footer.y + footer.height <= viewport.height - 11,
          "Actions clipped",
        );
        await batch();
        assert.equal(await page.locator("dialog[open]").count(), 1);
        await page
          .getByRole("button", { name: "确认转换 4 条", exact: true })
          .click();
        assert.equal(await page.evaluate(() => window.__batchAnswer), true);
      }
    }
    await format(true);
    await page.getByRole("button", { name: "生成预览", exact: true }).click();
    await page.mouse.click(3, 3);
    assert.equal(await page.evaluate(() => window.__dialogAnswer), null);
    await page.waitForFunction(() => window.__dialogDisposed === 1);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await format();
    const box = await page.locator("dialog[open]").boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(3, 3);
    await page.mouse.up();
    assert.equal(
      await page.locator("dialog[open]").count(),
      1,
      "Dragging from content must not dismiss",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__dialogAnswer), null);
    assert.deepEqual(errors, []);
  }
  console.log(
    JSON.stringify({
      baseline,
      initial,
      errors,
      repetitions: baseline ? 0 : 20,
    }),
  );
} finally {
  await browser.close();
}
