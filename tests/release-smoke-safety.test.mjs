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

test("installed Word pipe smoke binds installed payload hashes and isolates the development add-in", () => {
  const host = fs.readFileSync("scripts/run-word-pipe-batch-smoke.ps1", "utf8");
  assert.match(host, /LaTeXSnipper\.NativeOffice\.Shared\.dll/);
  assert.match(host, /Installed-addin acceptance requires ExpectedStagingRoot/);
  assert.match(host, /Installed payload provenance differs/);
  assert.match(host, /Installed payload hash mismatch/);
  assert.match(host, /\$word\.COMAddIns\.Item\(\$AddinProgId\)/);
  assert.match(
    host,
    /development add-in loaded during installed-addin acceptance/,
  );
  const cleanup = host.slice(host.lastIndexOf("finally {"));
  assert.match(cleanup, /-Name LoadBehavior -Value \$developmentLoadBehavior/);
});

test("OLE package export inspection resolves dumpbin before inspecting extracted DLLs", () => {
  const script = fs.readFileSync("scripts/verify-package-contents.ps1", "utf8");
  const resolved = script.indexOf("$dumpbin = Resolve-Dumpbin");
  assert.ok(resolved >= 0);
  assert.ok(resolved < script.indexOf("$exports = & $dumpbin"));
  assert.match(script, /dumpbin is required to verify packaged OLE exports/);
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
  assert.match(driver, /NATIVE_BATCH_TEST_UI === "1"/);
  assert.match(driver, /#officeWorkspaceBatch/);
  assert.match(driver, /dialog\.office-batch-dialog/);
  assert.match(driver, /确认转换 4 条/);
  assert.match(driver, /exactly one host session/);
});
