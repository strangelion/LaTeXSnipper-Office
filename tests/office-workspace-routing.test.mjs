import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Office.js exposes desktop workspaces and in-pane formula conversion", () => {
  const html = read("apps/office-addin/src/taskpane.html");
  const logic = read("apps/office-addin/src/taskpane/taskpane.ts");
  for (const workspace of [
    "formula-library",
    "recognition",
    "drawing",
    "batch",
    "office",
    "diagnostics",
    "settings",
  ]) {
    assert.match(html, new RegExp(`data-workspace="${workspace}"`));
  }
  for (const format of ["omml", "mathml", "svg", "png"]) {
    assert.match(html, new RegExp(`data-convert-format="${format}"`));
  }
  assert.match(logic, /\/api\/office\/open-workspace/);
  assert.match(logic, /\/api\/office\/convert\/v1/);
  assert.match(logic, /navigator\.clipboard\.writeText/);
});

test("desktop routes COM and Office.js workspace launches to exact surfaces", () => {
  const main = read("src/main.js");
  const protocol = read("src-tauri/src/platforms/pipe_protocol.rs");
  const session = read("src-tauri/src/platforms/session.rs");
  const bridge = read("src-tauri/src/platforms/office_bridge.rs");
  assert.match(protocol, /workspace: Option<String>/);
  assert.match(session, /"workspace": workspace/);
  assert.match(main, /openDesktopWorkspace\(workspace \|\| "editor"\)/);
  assert.match(main, /listen\("office-open-workspace"/);
  assert.match(bridge, /"\/api\/office\/open-workspace"/);
  assert.match(bridge, /\("latex", "mathml"\)/);
});

test("large Office batches are bounded and preserve completed chunks", () => {
  const batch = read("src-tauri/src/commands/office_batch.rs");
  assert.match(batch, /const CHUNK_SIZE: usize = 100/);
  assert.match(batch, /plan\.items\.chunks\(CHUNK_SIZE\)/);
  assert.match(batch, /aggregate\.converted \+=/);
  assert.match(batch, /Batch stopped after/);
  assert.doesNotMatch(batch, /Err\(error\)\s*=>\s*return Err/);
  assert.match(batch, /locator_start\(right\)\.cmp\(&locator_start\(left\)\)/);
  assert.match(batch, /"office-batch-progress"/);
  assert.match(batch, /"complete": true/);
});
