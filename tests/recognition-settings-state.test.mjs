import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/features/recognition/settings.js", import.meta.url),
  "utf8",
);
const errorRenderer = source.slice(
  source.indexOf("function renderAreaError"),
  source.indexOf("function renderReadiness"),
);

assert.match(
  errorRenderer,
  /area === "readiness"[\s\S]*recognitionReadinessStatus/,
);
assert.doesNotMatch(
  errorRenderer,
  /area === "capabilities" \|\| area === "readiness"/,
);
assert.match(source, /正在重新获取 Core 就绪状态/);
for (const label of [
  "已声明",
  "已检测运行库",
  "探测通过",
  "会话已创建",
  "冒烟推理通过",
  "基准已测量",
  "基准已验证",
]) {
  assert.match(source, new RegExp(label));
}

console.log("Recognition settings state isolation contracts passed OK");
