import assert from "node:assert/strict";
import test from "node:test";
import { detectPackageImpact } from "../scripts/detect-package-impact.mjs";

test("documentation changes do not trigger package builds", () => {
  assert.deepEqual(detectPackageImpact(["docs/readme.md"]), {
    paths: ["docs/readme.md"],
    windows_package: false,
    linux_package: false,
    macos_package: false,
    any_package: false,
  });
});

test("Native Office changes trigger only Windows package smoke", () => {
  const result = detectPackageImpact([
    "apps/native-office/OleActivationProbe/main.cpp",
  ]);
  assert.equal(result.windows_package, true);
  assert.equal(result.linux_package, false);
  assert.equal(result.macos_package, false);
});

test("WPS and shared package workflow changes trigger all platforms", () => {
  for (const path of [
    "apps/wps/main.js",
    "src/main.js",
    "apps/obsidian-plugin/main.ts",
    "src-tauri/tauri.ci.conf.json",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/package-verify.yml",
  ]) {
    const result = detectPackageImpact([path]);
    assert.equal(result.windows_package, true);
    assert.equal(result.linux_package, true);
    assert.equal(result.macos_package, true);
  }
});

test("Windows CI config changes do not trigger non-Windows packages", () => {
  const result = detectPackageImpact(["src-tauri/tauri.ci.windows.conf.json"]);
  assert.equal(result.windows_package, true);
  assert.equal(result.linux_package, false);
  assert.equal(result.macos_package, false);
});
