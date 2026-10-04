// Real Chromium UI; injected host callbacks are NOT live Office pipe acceptance.
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
const directory = "output/playwright/office-format-conversion";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__app?.editor));
  await page
    .getByRole("button", { name: "Office", exact: true })
    .first()
    .click();
  await page.locator("#officeWorkspaceFormat").click();
  const dialog = page.locator("dialog.office-format-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await dialog.getByRole("radio", { name: /MathType/ }).isDisabled(),
    true,
  );
  assert.equal(
    await dialog.getByRole("radio", { name: /LaTeXSnipper OLE/ }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  async function open(fail = false, delayed = false) {
    await page.evaluate(
      async ({ fail, delayed }) => {
        const { openFormatConversionDialog } =
          await import("/services/office-format-conversion.js");
        window.__formatDisposed = 0;
        window.__formatRendered = 0;
        window.__formatAnswer = openFormatConversionDialog({
          context: {
            native: true,
            host: "word",
            documentContext: "fixture-doc",
            sessionId: "fixture-a",
            documents: [
              {
                host: "word",
                sessionId: "fixture-a",
                documentContext: "fixture-doc",
                documentTitle: "同名文档",
                managed: true,
                ole: true,
              },
              {
                host: "word",
                sessionId: "fixture-b",
                documentContext: 'fixture-doc-"b"',
                documentTitle: "同名文档",
                managed: false,
                ole: true,
              },
            ],
            connected: true,
            managed: true,
            editor: true,
            engine: true,
            ole: true,
          },
          prepare: async ({ source, format, document }) => {
            if (delayed)
              await new Promise((resolve) => setTimeout(resolve, 150));
            if (fail) throw new Error("Injected source validation failure");
            return {
              latex: String.raw`\frac{a}{b}`,
              source,
              format,
              target: document,
            };
          },
          renderPreview: async (value) => {
            window.__formatRendered++;
            return window.__app.editor.createPreviewNode(value.latex, false);
          },
          dispose: async () => {
            window.__formatDisposed++;
          },
        });
      },
      { fail, delayed },
    );
  }
  await open();
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await dialog.getByRole("button", { name: "确认原位转换" }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".office-format-dialog .conversion-actions button:nth-child(2)",
      ).disabled,
  );
  assert.ok(
    await dialog
      .locator(
        ".office-selection-preview svg, .office-selection-preview math, .office-selection-preview .katex",
      )
      .count(),
  );
  await dialog
    .getByRole("radio", { name: "LaTeXSnipper OLE", exact: true })
    .click();
  assert.equal(
    await dialog.getByRole("button", { name: "确认原位转换" }).isDisabled(),
    true,
  );
  await page.waitForFunction(() => window.__formatDisposed === 1);
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".office-format-dialog .conversion-actions button:nth-child(2)",
      ).disabled,
  );
  await dialog.getByRole("button", { name: "确认原位转换" }).click();
  assert.equal(
    (await page.evaluate(() => window.__formatAnswer)).format,
    "ole",
  );
  assert.equal(await page.evaluate(() => window.__formatDisposed), 1);

  await open();
  const documents = dialog.getByRole("group", {
    name: "目标文档",
    exact: true,
  });
  assert.equal(await documents.getByRole("radio").count(), 2);
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".conversion-actions button:nth-child(2)")
        .disabled,
  );
  await documents.getByRole("radio", { name: /fixture-b/ }).click();
  assert.equal(
    await dialog.getByRole("button", { name: "确认原位转换" }).isDisabled(),
    true,
  );
  assert.equal(
    await dialog.locator(".office-selection-preview").isVisible(),
    false,
  );
  await page.waitForFunction(() => window.__formatDisposed === 1);
  assert.equal(
    await dialog
      .getByRole("radio", { name: /已读取的本应用公式/ })
      .isDisabled(),
    true,
  );
  await documents.getByRole("radio", { name: /fixture-b/ }).press("ArrowUp");
  assert.equal(
    await documents
      .getByRole("radio", { name: /fixture-a/ })
      .getAttribute("aria-checked"),
    "true",
  );
  await documents.getByRole("radio", { name: /fixture-a/ }).press("ArrowDown");
  await dialog.getByRole("radio", { name: "SVG 矢量图", exact: true }).click();
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".conversion-actions button:nth-child(2)")
        .disabled,
  );
  await dialog.getByRole("button", { name: "确认导出副本" }).click();
  const chosen = await page.evaluate(() => window.__formatAnswer);
  assert.equal(chosen.prepared.target.sessionId, "fixture-b");
  assert.equal(chosen.prepared.target.documentContext, 'fixture-doc-"b"');
  assert.equal(chosen.source, "selection");
  assert.equal(chosen.format, "svg");

  await open(true);
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await dialog.getByText(/预览失败：Injected/).waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "确认原位转换" }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__formatAnswer), null);
  await open(false, true);
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__formatAnswer), null);
  await page.waitForFunction(() => window.__formatDisposed === 1);
  assert.equal(await page.evaluate(() => window.__formatRendered), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".office-format-dialog .conversion-actions button:nth-child(2)",
      ).disabled,
  );
  const bounds = await dialog.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 390 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 844,
  );
  assert.equal(
    await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1),
    false,
  );
  await page.screenshot({ path: join(directory, "narrow-light.png") });
  await page.evaluate(() => {
    window.__app.themeManager.setMode("dark");
  });
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('.office-format-dialog [role="radio"]'),
      ).backgroundColor === "rgb(15, 17, 26)",
  );
  await dialog.evaluate((node) => {
    node.scrollTop = 0;
  });
  const themeStyles = await dialog.evaluate((node) => {
    const button = node.querySelector('[role="radio"]');
    const styles = getComputedStyle(button);
    const matching = [];
    const scan = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText && button.matches(rule.selectorText))
          matching.push({
            selector: rule.selectorText,
            style: rule.style.cssText,
          });
        if (rule.cssRules) scan(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        scan(sheet.cssRules);
      } catch {
        /* Cross-origin sheets are opaque. */
      }
    }
    return {
      background: styles.backgroundColor,
      color: styles.color,
      textFill: styles.webkitTextFillColor,
      bgVariable: styles.getPropertyValue("--bg"),
      fgVariable: styles.getPropertyValue("--fg"),
      disabled: button.disabled,
      matching,
    };
  });
  writeFileSync(
    join(directory, "theme-styles.json"),
    JSON.stringify(themeStyles, null, 2),
  );
  await page.screenshot({ path: join(directory, "narrow-dark.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__formatAnswer), null);

  // Use the production renderer to provide a matching image for real Word tests.
  const render = await page.evaluate(async () => {
    const result = await window.__app.formulaSvgRenderer.renderFormulaSvg(
      String.raw`\int_0^1 x\,dx`,
      { display: false },
    );
    return {
      svg: result.svg,
      png: await window.__app._svgToPngBase64(
        result.svg,
        result.widthPt,
        result.heightPt,
      ),
      widthPt: result.widthPt,
      heightPt: result.heightPt,
    };
  });
  writeFileSync(
    join(directory, "inline-integral-render.json"),
    JSON.stringify(render),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    failedRequests.filter(
      (item) =>
        item.url.startsWith("http://127.0.0.1:2100/") &&
        item.error !== "net::ERR_ABORTED",
    ),
    [],
  );
  console.log(
    "PASS: real browser format and document picker (same titles, distinct sessions), preview invalidation, keyboard navigation, confirm/cancel/Escape, failure and late cleanup, 390px light/dark. Host calls are fixtures, not live Office acceptance.",
  );
} finally {
  await browser.close();
}
