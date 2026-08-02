import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const lease = readFileSync(
  new URL("../src-tauri/src/screenshot/lease.rs", import.meta.url),
  "utf8",
);
const tests = readFileSync(
  new URL("../src-tauri/src/screenshot/tests.rs", import.meta.url),
  "utf8",
);
for (const state of ["Created", "InUse", "Completed", "Failed", "Cancelled"]) {
  assert.match(lease, new RegExp(`\\b${state}\\b`));
}
assert.match(lease, /created_at_unix_ms/);
assert.match(lease, /last_transition_at_unix_ms/);
assert.match(lease, /preview_paths/);
assert.match(lease, /24 \* 60 \* 60/);
assert.match(lease, /512 \* 1024 \* 1024/);
assert.match(tests, /protects_active_in_use_job/);
assert.match(tests, /enforces_oldest_first_size_cap/);
assert.match(tests, /recovers_stale_in_use_and_terminal_jobs/);

console.log("Screenshot lease lifecycle contract passed OK");
