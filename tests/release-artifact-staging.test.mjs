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

const staging = fs.readFileSync(
  "scripts/stage-release-artifacts.ps1",
  "utf8",
);

test("package verification stages WPS through an explicit deterministic path", () => {
  assert.match(packageVerify, /npm run build:wps/);

  assert.match(
    packageVerify,
    /\$wpsStaging\s*=\s*["']apps[\\/]wps[\\/]dist[\\/]latexsnipper-wps_\$version["']/,
  );

  assert.match(
    packageVerify,
    /-WpsStaging\s+\$wpsStaging/,
  );

  assert.doesNotMatch(
    packageVerify,
    /LastWriteTime/,
    "CI must not select WPS staging by modification time",
  );
});

test("release publishes only packages produced by package verification", () => {
  assert.match(
    releaseWorkflow,
    /uses:\s*\.\/\.github\/workflows\/package-verify\.yml/,
  );

  assert.match(
    releaseWorkflow,
    /pattern:\s*verified-\*-packages/,
  );

  assert.match(
    releaseWorkflow,
    /needs:\s*\[native-office-required,\s*package-required\]/,
  );
});

test("obsolete Build All workflow is not restored", () => {
  assert.equal(
    fs.existsSync(".github/workflows/build-all.yml"),
    false,
  );
});

test("WPS staging validates required files and rejects nested roots", () => {
  for (const required of [
    "index.html",
    "js/command-layer.js",
    "ui/taskpane.html",
  ]) {
    assert.match(
      staging,
      new RegExp(required.replace("/", "\\/")),
    );
  }

  assert.match(
    staging,
    /WPS artifact missing required file: \$relative/,
  );

  assert.match(
    staging,
    /WPS artifact contains forbidden nested root/,
  );
});
