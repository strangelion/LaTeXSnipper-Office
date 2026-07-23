import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageVerify = fs.readFileSync(
  ".github/workflows/package-verify.yml",
  "utf8",
);

const releaseWorkflow = fs.readFileSync(
  ".github/workflows/release.yml",
  "utf8",
);

const resourceStaging = fs.readFileSync("scripts/stage-resources.ps1", "utf8");

test("obsolete Build All release workflow is absent", () => {
  assert.equal(fs.existsSync(".github/workflows/build-all.yml"), false);
});

test("release publishes only package-verification outputs", () => {
  assert.match(
    releaseWorkflow,
    /uses:\s*\.\/\.github\/workflows\/package-verify\.yml/,
  );

  assert.match(
    releaseWorkflow,
    /source_ref:\s*\$\{\{\s*needs\.prepare-release\.outputs\.tag\s*\}\}/,
  );

  assert.match(
    releaseWorkflow,
    /expected_version:\s*\$\{\{\s*needs\.prepare-release\.outputs\.full_version\s*\}\}/,
  );

  assert.match(releaseWorkflow, /release_mode:\s*true/);

  assert.match(releaseWorkflow, /pattern:\s*verified-\*-packages/);
});

test("package verification stages WPS deterministically", () => {
  assert.match(packageVerify, /npm run build:wps/);

  assert.match(
    packageVerify,
    /\$wpsStaging\s*=\s*["']apps[\\/]wps[\\/]dist[\\/]latexsnipper-wps_\$version["']/,
  );

  assert.match(packageVerify, /-WpsStaging\s+\$wpsStaging/);

  assert.doesNotMatch(
    packageVerify,
    /LastWriteTime/,
    "CI must not select WPS staging by modification time",
  );
});

test("WPS staging requires the complete package root", () => {
  for (const required of [
    "index.html",
    "main.js",
    "manifest.xml",
    "ribbon.xml",
    "js/command-layer.js",
    "ui/taskpane.html",
  ]) {
    assert.match(resourceStaging, new RegExp(required.replace("/", "\\/")));
  }

  assert.match(resourceStaging, /WPS payload/);
});
