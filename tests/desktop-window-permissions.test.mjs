import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("post-scan confirmation can restore, show and focus the desktop window", () => {
  const capability = JSON.parse(
    readFileSync(
      new URL("../src-tauri/capabilities/default.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(capability.windows.includes("main"));
  for (const action of ["unminimize", "show", "set-focus"])
    assert.ok(
      capability.permissions.includes(`core:window:allow-${action}`),
      `Missing window permission: ${action}`,
    );
});
