import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

test("packaged desktop delegates internal Bridge operations to Tauri", () => {
  const source = read("src", "main.js");
  assert.match(source, /invoke\("list_ecosystem_clients_internal"/);
  assert.match(source, /invoke\("submit_office_render_asset_result"/);
  assert.match(source, /invoke\("push_ecosystem_action_internal"/);
  assert.match(source, /invoke\("get_bridge_runtime_diagnostics"/);
  assert.doesNotMatch(source, /fetch\s*\(\s*["']http:\/\/127\.0\.0\.1:19877/);
});

test("numbered Native Word intent is backed by a durable Rust transaction", () => {
  const transaction = read(
    "src-tauri",
    "src",
    "platforms",
    "office_transactions.rs",
  );
  const session = read("src-tauri", "src", "platforms", "session.rs");
  const frontend = read("src", "main.js");
  assert.match(transaction, /pub struct OfficeEditTransaction/);
  assert.match(transaction, /OFFICE_EDIT_TRANSACTION_TTL_MS/);
  assert.match(transaction, /replace_file_atomically/);
  assert.match(transaction, /OFFICE_TRANSACTION_CONFLICT/);
  assert.match(session, /EquationNumberingScheme::Global/);
  assert.match(frontend, /prepare_office_edit_commit/);
  assert.match(frontend, /complete_office_edit_transaction/);
  assert.match(frontend, /native_office_insert_formula/);
  assert.match(frontend, /mode: mode/);
});

test("WPS production source has separate three-host adapters and no legacy runtime", () => {
  const commandLayer = read("apps", "wps", "js", "command-layer.js");
  const adapters = read("apps", "wps", "js", "adapters.js");
  const build = read("apps", "wps", "build.ps1");
  for (const key of ["wps-writer", "wps-spreadsheets", "wps-presentation"]) {
    assert.match(commandLayer + adapters, new RegExp(key));
  }
  assert.match(adapters, /candidate-first-writer-update/);
  assert.match(adapters, /METADATA_READBACK_FAILED/);
  assert.match(adapters, /ORIGINAL_DELETE_FAILED/);
  for (const forbidden of [
    "http://127.0.0.1:8080",
    "127.0.0.1:28765",
    "127.0.0.1:28766",
    "http://127.0.0.1:19876",
    "/convert/latex",
    "Date.now() % 1000",
    "Word.run",
    "Excel.run",
    "PowerPoint.run",
    "Office.context",
  ]) {
    assert.doesNotMatch(
      commandLayer + adapters + build,
      new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.equal(fs.existsSync(path.join("apps", "wps", "server.js")), false);
  assert.equal(fs.existsSync(path.join("apps", "wps", "proxy.js")), false);
});

test("Native Office pipe callbacks use the owned STA boundary", () => {
  const shared = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Shared",
    "OfficeStaDispatcher.cs",
  );
  assert.match(shared, /ApartmentState\.STA/);
  assert.match(shared, /_maximumPendingOperations/);
  assert.match(shared, /OFFICE_STA_QUEUE_TIMEOUT/);
  for (const host of ["Word", "Excel", "PowerPoint"]) {
    const source = read(
      "apps",
      "native-office",
      `LaTeXSnipper.${host}`,
      "ThisAddIn.cs",
    );
    assert.match(source, /OfficeStaDispatcher/);
    assert.match(source, /TryPost\("handle-pipe-command"/);
    assert.doesNotMatch(source, /Task\.Run\s*\(/);
  }
});

test("Office and WPS pages declare restrictive CSPs", () => {
  const office = read("apps", "office-addin", "src", "taskpane.html");
  const wps = read("apps", "wps", "ui", "taskpane.html");
  for (const html of [office, wps]) {
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.doesNotMatch(html, /default-src \*/);
  }
  assert.match(office, /appsforoffice\.microsoft\.com/);
  assert.match(wps, /connect-src 'self'/);
});

test("browser content returns through desktop and never calls Office or WPS hosts", () => {
  const browserSource = ["background.ts", "content.ts", "popup.ts"]
    .map((file) => read("apps", "browser-extension", "src", file))
    .join("\n");
  const bridge = read(
    "apps",
    "browser-extension",
    "src",
    "bridge",
    "client.ts",
  );
  const desktop = read("src", "main.js");
  assert.match(browserSource, /target:\s*"desktop"/);
  assert.match(bridge, /127\.0\.0\.1:19877/);
  assert.match(desktop, /list_browser_imports/);
  assert.match(desktop, /native_office_import_conversation/);
  assert.doesNotMatch(
    browserSource + bridge,
    /Office\.context|Word\.run|Excel\.run|PowerPoint\.run|wps\./,
  );
});

test("browser inbox is durable and every Windows package carries provenance", () => {
  const store = read("src-tauri", "src", "platforms", "conversation_import.rs");
  const windowsConfig = read("src-tauri", "tauri.windows.conf.json");
  const ciWindowsConfig = read("src-tauri", "tauri.ci.windows.conf.json");
  const verifier = read("scripts", "verify-package-contents.ps1");
  assert.match(store, /load_persisted_records/);
  assert.match(store, /replace_persisted_file/);
  assert.match(store, /persisted_import_survives_restart_and_update/);
  assert.match(windowsConfig, /resources\/provenance\.json/);
  assert.match(ciWindowsConfig, /resources\/provenance\.json/);
  assert.match(verifier, /Directory\.Name -eq "resources"/);
  assert.match(verifier, /Legacy WPS runtime must not be packaged/);
  const requiredWpsFiles = verifier.slice(
    verifier.indexOf("foreach ($relative"),
    verifier.indexOf("foreach ($legacy"),
  );
  assert.doesNotMatch(requiredWpsFiles, /proxy\.js|server\.js/);
});

test("DirectML staging is Windows-only", () => {
  const buildScript = read("src-tauri", "build.rs");
  assert.match(
    buildScript,
    /#\[cfg\(target_os = "windows"\)\]\s+copy_directml_dll\(\)/,
  );
  assert.match(
    buildScript,
    /#\[cfg\(target_os = "windows"\)\]\s+fn copy_directml_dll/,
  );
});
