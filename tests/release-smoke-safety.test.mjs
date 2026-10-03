import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("release WebView smoke restores the original custom-symbol library on exit", () => {
  const script = fs.readFileSync(
    "scripts/verify-tauri-release-webview.mjs",
    "utf8",
  );
  assert.match(script, /originalSymbolLibrary = await page\.evaluate/);
  const cleanup = script.slice(script.lastIndexOf("} finally {"));
  assert.match(cleanup, /originalSymbolLibrary !== undefined/);
  assert.match(cleanup, /original === null\) localStorage\.removeItem\(key\)/);
  assert.match(cleanup, /else localStorage\.setItem\(key, original\)/);
  assert.match(cleanup, /latexsnipper:custom-symbol-library-changed/);
});

test("real Word pipe smoke requires an exact dedicated document before mutation", () => {
  const driver = fs.readFileSync(
    "scripts/verify-native-batch-webview.mjs",
    "utf8",
  );
  const host = fs.readFileSync("scripts/run-word-pipe-batch-smoke.ps1", "utf8");
  assert.match(driver, /assert\.ok\(\s*expectedDocument/);
  assert.match(driver, /document_id\?\.replaceAll[\s\S]*?=== context/);
  assert.ok(
    driver.indexOf("candidates.length !== 4") <
      driver.indexOf('invoke("office_batch_execute"'),
  );
  assert.match(host, /Get-Process WINWORD/);
  assert.match(host, /The harness DOCX already exists/);
  assert.match(host, /\$env:NATIVE_BATCH_TEST_DOCUMENT = \$documentPath/);
  assert.match(
    host,
    /\$word\.Documents\.Open\(\$documentPath, \$false, \$true\)/,
  );
  assert.match(host, /Equation count changed after save\/reopen/);
});
