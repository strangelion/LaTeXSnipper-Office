import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/build-all.yml", "utf8");
const staging = fs.readFileSync("scripts/stage-release-artifacts.ps1", "utf8");

test("tauri-windows consumes the versioned WPS artifact through explicit staging", () => {
  const section = workflow.slice(
    workflow.indexOf("  tauri-windows:"),
    workflow.indexOf("  tauri-macos:"),
  );
  assert.match(section, /needs:\s*\[prepare, office-addin, vsto, wps\]/);
  assert.match(section, /name:\s*Download WPS artifact/);
  assert.match(section, /name:\s*wps/);
  assert.match(section, /needs\.prepare\.outputs\.version/);
  assert.match(section, /stage-release-artifacts\.ps1/);
  assert.match(section, /-WpsStaging \$env:WPS_STAGING/);
  assert.doesNotMatch(section, /LastWriteTime/);
});

test("WPS staging fails with exact missing paths and rejects nested roots", () => {
  for (const required of [
    "index.html",
    "js/command-layer.js",
    "ui/taskpane.html",
  ])
    assert.match(staging, new RegExp(required.replace("/", "\\/")));
  assert.match(staging, /WPS artifact missing required file: \$relative/);
  assert.match(staging, /WPS artifact contains forbidden nested root/);
});
