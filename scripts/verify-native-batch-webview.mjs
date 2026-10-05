import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// This mutates a document: require the dedicated harness path, never select
// an arbitrary active Word session or a user's open document.
const expectedDocument = process.env.NATIVE_BATCH_TEST_DOCUMENT;
assert.ok(
  expectedDocument,
  "NATIVE_BATCH_TEST_DOCUMENT must name the harness DOCX",
);
const endpoint = process.env.WEBVIEW2_CDP_URL || "http://127.0.0.1:9223";
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("http://tauri.localhost/"));
  assert.ok(page, "No production Tauri WebView page found");
  const expectedContext = `word:${expectedDocument}`
    .replaceAll("\\", "/")
    .toLowerCase();
  await page.waitForFunction(
    async (context) => {
      const sessions = await window.__TAURI_INTERNALS__.invoke(
        "native_office_sessions",
      );
      return sessions.some(
        (session) =>
          session.host_type === "word" &&
          session.document_id?.replaceAll("\\", "/").toLowerCase() === context,
      );
    },
    expectedContext,
    { timeout: 30_000, polling: 500 },
  );

  let evidence;
  if (process.env.NATIVE_BATCH_TEST_UI === "1") {
    const started = Date.now();
    const session = await page.evaluate(async (context) => {
      await window.__app.updateOfficeHostSelector();
      const matches = window.__app._sessions.filter(
        (candidate) =>
          candidate.host_type === "word" &&
          candidate.document_id?.replaceAll("\\", "/").toLowerCase() ===
            context,
      );
      if (matches.length !== 1)
        throw new Error(
          "The dedicated document must have exactly one host session",
        );
      return matches[0];
    }, expectedContext);
    await page.locator("#officeBtn").click();
    await page.locator("#officeHostSelector .custom-select-trigger").click();
    assert.match(session.session_id, /^[a-zA-Z0-9_-]+$/);
    await page
      .locator(
        `#officeTargetHost .custom-select-option[data-value="${session.session_id}"]`,
      )
      .click();
    assert.equal(
      await page.evaluate(() => window.__app._selectedSessionId),
      session.session_id,
    );
    await page.locator("#officeWorkspaceBatch").click();
    const confirmation = page.locator("dialog.office-batch-dialog");
    await confirmation.waitFor({ state: "visible", timeout: 45_000 });
    const preview = await confirmation.textContent();
    assert.ok(preview.includes(session.document_id));
    assert.match(preview, /4\/4 条可转换/);
    await confirmation
      .getByRole("button", { name: "确认转换 4 条", exact: true })
      .click();
    await page.waitForFunction(
      () => !window.__app._officeBatchConversionBusy,
      null,
      { timeout: 150_000 },
    );
    const summary = await page.locator("#statusText").textContent();
    if (!/批量转换结果：4\/4；跳过 0，失败 0/.test(summary)) {
      console.log(
        JSON.stringify(
          { pass: false, uiConfirmed: true, preview, summary },
          null,
          2,
        ),
      );
      throw new Error(
        "The confirmed UI batch did not complete all four formulas",
      );
    }
    evidence = {
      runtime: "Tauri release WebView2 UI to real Word VSTO named pipe",
      uiConfirmed: true,
      preview,
      summary,
      scanned: 4,
      result: { total: 4, converted: 4, skipped: 0, failed: 0, failures: [] },
      durationMs: Date.now() - started,
    };
  } else {
    evidence = await page.evaluate(async (context) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const sessions = await invoke("native_office_sessions");
      const session = sessions.find(
        (candidate) =>
          candidate.host_type === "word" &&
          candidate.document_id?.replaceAll("\\", "/").toLowerCase() ===
            context,
      );
      if (!session) throw new Error("Dedicated harness session disappeared");
      const target = {
        host: "word",
        sessionId: session.session_id,
        documentContext: session.document_id,
      };
      const started = performance.now();
      const candidates = await invoke("office_batch_scan_latex", {
        target,
        scope: "entireDocument",
      });
      if (candidates.length !== 4)
        throw new Error(
          `Expected 4 harness candidates, got ${candidates.length}`,
        );
      const plan = await invoke("office_batch_convert_plan", {
        target,
        candidates,
      });
      const result = await invoke("office_batch_execute", { plan });
      return {
        runtime: "Tauri release WebView2 to real Word VSTO named pipe",
        scanned: candidates.length,
        result,
        durationMs: Math.round(performance.now() - started),
      };
    }, expectedContext);
  }
  const pass =
    evidence.result.total === 4 &&
    evidence.result.converted === 4 &&
    evidence.result.skipped === 0 &&
    evidence.result.failed === 0 &&
    evidence.result.failures.length === 0;
  // Preserve partial failures before assertions terminate the harness.
  console.log(JSON.stringify({ pass, ...evidence }, null, 2));
  assert.equal(evidence.result.total, 4);
  assert.equal(evidence.result.converted, 4);
  assert.equal(evidence.result.skipped, 0);
  assert.equal(evidence.result.failed, 0);
  assert.deepEqual(evidence.result.failures, []);
} finally {
  await browser.close();
}
