import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

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

const tauriConfig = JSON.parse(
  readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"),
);
const csp = tauriConfig?.app?.security?.csp || "";
assert.match(
  csp,
  /script-src\s+[^;]*'self'[^;]*'wasm-unsafe-eval'/,
  "Tauri CSP must allow bundled WASM without enabling general eval",
);
assert.doesNotMatch(
  csp.replaceAll("'wasm-unsafe-eval'", ""),
  /'unsafe-eval'/,
  "Tauri CSP must not enable general unsafe-eval",
);

const tikzWasm = gunzipSync(readFileSync(join(root, "tex.wasm.gz")));
assert.equal(tikzWasm.subarray(0, 4).toString("hex"), "0061736d");
await WebAssembly.compile(tikzWasm);

const { instance } = await import("@viz-js/viz");
const graphviz = await instance();
const graphvizSvg = graphviz.renderString("digraph G { A -> B; }", {
  engine: "dot",
  format: "svg",
});
assert.match(graphvizSvg, /<svg[\s>]/);
assert.match(graphvizSvg, /A/);
assert.match(graphvizSvg, /B/);

console.log("Bundled Graphviz/TikZ WASM runtime and Tauri CSP smoke OK");
