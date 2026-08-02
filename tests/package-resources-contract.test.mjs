import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../contracts/resources.v1.json", import.meta.url)),
);
const submoduleSha = execFileSync(
  "git",
  ["-C", "src-tauri/latexsnipper-core", "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
assert.equal(submoduleSha, manifest.coreSubmoduleSha);
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(actual, expected, `${file} resource hash drifted`);
}

console.log("Office package resource contract passed OK");
