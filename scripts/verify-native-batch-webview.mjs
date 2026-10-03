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

  const evidence = await page.evaluate(async (context) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const sessions = await invoke("native_office_sessions");
    const session = sessions.find(
      (candidate) =>
        candidate.host_type === "word" &&
        candidate.document_id?.replaceAll("\\", "/").toLowerCase() === context,
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
  assert.equal(evidence.result.total, 4);
  assert.equal(evidence.result.converted, 4);
  assert.equal(evidence.result.skipped, 0);
  assert.equal(evidence.result.failed, 0);
  assert.deepEqual(evidence.result.failures, []);
  console.log(JSON.stringify({ pass: true, ...evidence }, null, 2));
} finally {
  await browser.close();
}
