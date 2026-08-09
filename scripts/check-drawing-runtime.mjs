import { strict as assert } from "node:assert";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("dist/vendor/tikzjax");
const required = [
  "run-tex.js",
  "tex.wasm.gz",
  "core.dump.gz",
  "fonts.min.css",
  "assets/broken-image.svg",
];

for (const file of required) {
  const path = join(root, file);
  assert.ok(existsSync(path), `bundled TikZ runtime file is missing: ${file}`);
  assert.ok(
    statSync(path).size > 0,
    `bundled TikZ runtime file is empty: ${file}`,
  );
}

const texFiles = join(root, "tex_files");
assert.ok(existsSync(texFiles), "bundled TikZ tex_files directory is missing");
assert.ok(
  readdirSync(texFiles, { recursive: true }).length >= 200,
  "bundled TikZ tex_files directory is incomplete",
);

console.log("Bundled offline drawing runtime is complete OK");
