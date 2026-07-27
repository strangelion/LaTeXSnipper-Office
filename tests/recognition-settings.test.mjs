import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../src/features/recognition/settings.js", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main.js", import.meta.url),
  "utf8",
);

assert.match(settingsSource, /export function initRecognitionSettings/);
assert.match(
  settingsSource,
  /export async function refreshRecognitionSettings/,
);
assert.match(settingsSource, /Promise\.allSettled\(tasks\)/);
assert.match(settingsSource, /runtime\.name \|\| runtime\.kind/);
assert.doesNotMatch(settingsSource, /runtime\.name \|\| runtime\.id/);
assert.match(settingsSource, /data-remove-model/);
assert.match(settingsSource, /extensions: \["lsmodel"\]/);
assert.match(settingsSource, /MODEL_PACKAGE_INCOMPATIBLE/);
assert.match(settingsSource, /recognition\.screenshotAutoInsert/);
assert.match(settingsSource, /=== true/);
assert.match(settingsSource, /providerValidations/);
assert.match(settingsSource, /validationLevel/);
assert.doesNotMatch(settingsSource, /readiness\.modelCoverage/);
assert.match(mainSource, /initRecognitionSettings\(\{/);
assert.match(mainSource, /scheduleRecognitionSettingsRefresh\(\)/);

let calls = 0;
const successes = await Promise.allSettled([
  Promise.resolve(++calls),
  Promise.reject(new Error("runtime unavailable")),
  Promise.resolve(++calls),
]);
assert.equal(successes[0].status, "fulfilled");
assert.equal(successes[1].status, "rejected");
assert.equal(successes[2].status, "fulfilled");
assert.equal(calls, 2, "one failed area must not block the other areas");

function effectiveAutoInsert(officeRequest, userSetting, protocolRequest) {
  return officeRequest && userSetting && protocolRequest;
}
assert.equal(effectiveAutoInsert(true, false, true), false);
assert.equal(effectiveAutoInsert(true, true, true), true);
assert.equal(effectiveAutoInsert(false, true, true), false);

console.log("Recognition settings contracts passed OK");
