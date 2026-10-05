// Dedicated isolated release profile only. Never scans or writes an Office document.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

assert.equal(
  process.env.TAURI_UI_ISOLATED_PROFILE,
  "1",
  "Use an isolated test profile",
);
const expectedCommit = process.env.EXPECTED_TAURI_SOURCE_COMMIT;
assert.match(
  expectedCommit || "",
  /^[a-f0-9]{40}$/,
  "Specify the built source commit",
);
const output = "output/playwright/tauri-conversion-ui";
mkdirSync(output, { recursive: true });
const browser = await chromium.connectOverCDP(
  process.env.WEBVIEW2_CDP_URL || "http://127.0.0.1:9223",
);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("http://tauri.localhost/"));
  assert.ok(page, "No production Tauri page found");
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  const backend = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const diagnostics = await invoke("export_diagnostics");
    for (const command of ["unminimize", "show", "set_focus"])
      await invoke(`plugin:window|${command}`, { label: "main" });
    return {
      sourceCommitSha: diagnostics.sourceCommitSha,
      coreCommitSha: diagnostics.coreCommitSha,
    };
  });
  assert.equal(backend.sourceCommitSha, expectedCommit);

  await page.keyboard.press("Escape");
  await page.locator("#editorBtn").click();
  await page.locator("#formulaModeTab").click();
  const editor = page.locator("#formulaSourceEditor .cm-content");
  await editor.fill("\\frac{1}{2}");
  await page.waitForFunction(
    () => document.querySelector("#latexSource")?.value === "\\frac{1}{2}",
  );
  await page.locator("#officeBtn").click();
  const layouts = [];
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (let repeat = 0; repeat < 5; repeat++) {
      await page.locator("#officeWorkspaceFormat").click();
      const dialog = page.locator("dialog.office-format-dialog[open]");
      await dialog.waitFor({ state: "visible" });
      assert.equal(await page.locator("dialog[open]").count(), 1);
      const bounds = await dialog.boundingBox();
      const footer = await dialog.locator(".conversion-actions").boundingBox();
      assert.ok(
        Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) <= 1,
      );
      assert.ok(
        bounds.y >= 11 && bounds.y + bounds.height <= viewport.height - 11,
      );
      assert.ok(
        footer.y >= bounds.y &&
          footer.y + footer.height <= viewport.height - 11,
      );
      await dialog
        .getByRole("button", { name: "生成预览", exact: true })
        .click();
      await dialog
        .locator(".office-selection-preview")
        .waitFor({ state: "visible", timeout: 15000 });
      assert.equal(await dialog.locator("pre").textContent(), "\\frac{1}{2}");
      assert.ok(
        await dialog
          .locator(".office-selection-preview")
          .evaluate(
            (node) =>
              node.childElementCount > 0 &&
              node.getBoundingClientRect().height > 0,
          ),
      );
      assert.equal(
        await dialog
          .getByRole("button", { name: "确认导出副本", exact: true })
          .isEnabled(),
        true,
      );
      if (repeat === 0) {
        layouts.push({ viewport, bounds, footer });
        await page.screenshot({
          path: `${output}/format-${viewport.width}.png`,
        });
      }
      if (repeat % 2 === 0) await page.mouse.click(3, 3);
      else await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(
        () => !window.__app._officeFormatConversionBusy,
      );
    }
  }
  const plan = await page.evaluate(async () => {
    const sources = [
      "$x$",
      "\\(x\\)",
      "\\frac{1}{2}",
      "\\begin{align*}x&=1\\end{align*}",
    ];
    return window.__TAURI_INTERNALS__.invoke("office_batch_convert_plan", {
      target: {
        host: "word",
        sessionId: "readonly-fixture",
        documentContext: "readonly-fixture",
      },
      candidates: sources.map((source, index) => ({
        id: `fixture-${index}`,
        source,
        normalizedLatex: index < 2 ? "x" : source,
        location: `fixture-${index}`,
        locator: { start: index * 10 },
        confidence: 1,
      })),
    });
  });
  assert.deepEqual(
    plan.items.map((item) => item.status),
    ["converted", "converted", "converted", "failed"],
  );
  assert.equal(plan.items[0].omml, plan.items[1].omml);
  assert.notDeepEqual(plan.items[0].locator, plan.items[1].locator);
  for (const item of plan.items)
    assert.equal(
      item.sourceHash,
      createHash("sha256").update(item.sourceText).digest("hex"),
    );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    failedRequests.filter(
      (request) =>
        request.url.startsWith("http://tauri.localhost/") &&
        request.error !== "net::ERR_ABORTED",
    ),
    [],
  );
  const result = {
    pass: true,
    runtime: "Tauri release WebView2",
    backend,
    windowCommandsAuthorized: true,
    conversionPreviews: 10,
    layouts,
    readonlyPlan: { converted: 3, failed: 1, distinctLocationsAndHashes: true },
    errors,
    failedRequests,
    scope:
      "No Office scan/execute; no real Word handoff or installer acceptance",
  };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
