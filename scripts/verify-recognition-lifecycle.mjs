import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

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

// This gate verifies real browser UI with controlled IPC outcomes, not model accuracy.
const browser = await chromium.launch({
  executablePath: browserExecutable,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.locator("#ocrBtn").click();
  await page.evaluate(async () => {
    const controller = await import("/features/recognition/controller.js");
    const store = await import("/features/recognition/store.js");
    const view = await import("/features/recognition/view.js");
    // The production bootstrap only mounts this feature in a desktop runtime.
    view.bindRecognitionTab();
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "recognition_get_output")
          return { success: true, content: "x^2 + y^2 = z^2" };
        if (command === "recognition_cancel") {
          await controller.handleJobUpdate({
            id: args.jobId,
            status: "cancelled",
          });
          return true;
        }
        return null;
      },
    };
    store.initJobStore();
    window.dispatchEvent(
      new CustomEvent("recognition:job-started", {
        detail: { jobId: "job-success" },
      }),
    );
    await controller.handleJobUpdate({
      id: "job-success",
      status: "running",
      message: "识别测试",
    });
  });
  assert.equal(
    await page.locator('[data-cancel-job="job-success"]').isVisible(),
    true,
  );
  assert.match(
    await page.locator("#recognitionStatusBadge").innerText(),
    /处理中/,
  );
  await page.evaluate(async () => {
    const { handleJobUpdate } =
      await import("/features/recognition/controller.js");
    await handleJobUpdate({
      id: "job-success",
      status: "completed",
      progress: 1,
    });
    await handleJobUpdate({
      id: "job-timeout",
      status: "failed",
      error: "RECOGNITION_TIMEOUT: 超时测试",
    });
    await handleJobUpdate({ id: "job-cancel", status: "running" });
  });
  assert.equal(await page.locator("#ocrResult").innerText(), "x^2 + y^2 = z^2");
  assert.equal(await page.locator("#ocrCopyBtn").isEnabled(), true);
  assert.match(
    await page.locator('[data-job-id="job-timeout"]').innerText(),
    /RECOGNITION_TIMEOUT/,
  );
  await page.locator('[data-cancel-job="job-cancel"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-job-id="job-cancel"]')
      .textContent.includes("已取消"),
  );
  assert.equal(await page.locator('[data-cancel-job="job-cancel"]').count(), 0);
  mkdirSync("output/playwright/recognition-lifecycle", { recursive: true });
  await page.screenshot({
    path: "output/playwright/recognition-lifecycle/states.png",
  });
  const graphviz = await page.evaluate(async () => {
    const { renderGraphviz } =
      await import("/features/drawing/local-renderers.js");
    return renderGraphviz("digraph G { A -> B }");
  });
  assert.match(graphviz, /^<svg\b/);
  assert.doesNotMatch(graphviz, /DOCTYPE|svg11\.dtd/);
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: browser running/cancel/completed/output/error states; Graphviz inline SVG.",
  );
  console.log(
    "Scope: simulated IPC, not native model inference or Office host insertion.",
  );
} finally {
  await browser.close();
}
