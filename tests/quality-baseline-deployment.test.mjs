import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(
  "src-tauri/src/recognition/quality_baselines.rs",
  "utf8",
);
const setup = readFileSync("src-tauri/src/lib.rs", "utf8");
const html = readFileSync("src/index.html", "utf8");
const frontend = readFileSync("src/main.js", "utf8");

assert.match(rust, /pub struct BaselineDeploymentState/);
assert.match(rust, /status: "failed"\.to_string\(\)/);
assert.match(setup, /app\.manage\(baseline_deployment\)/);
assert.match(setup, /quality_baseline_deployment_status/);
assert.match(html, /id="qualityBaselineDeploymentState"/);
assert.match(frontend, /质量基线部署失败/);
assert.match(frontend, /report\.error/);
assert.match(frontend, /无法读取本地状态，请在桌面应用中重试/);
assert.doesNotMatch(frontend, /detailNode\.textContent = String\(error\)/);

console.log("Quality baseline deployment visibility contract passed OK");
