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
assert.match(source, /正在重新获取 Core readiness/);
for (const level of [
  "Declared",
  "LibraryDetected",
  "ProbePassed",
  "SessionCreated",
  "SmokeInferencePassed",
  "BenchmarkValidated",
]) {
  assert.match(source, new RegExp(level));
}

console.log("Recognition settings state isolation contracts passed OK");
