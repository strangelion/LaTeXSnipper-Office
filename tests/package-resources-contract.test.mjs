import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../contracts/resources.v1.json", import.meta.url)),
);
const gitlink = execFileSync(
  "git",
  ["ls-tree", "HEAD", "--", "src-tauri/latexsnipper-core"],
  { encoding: "utf8" },
).trim();
const submoduleSha = gitlink.match(
  /^160000 commit ([0-9a-f]{40})\tsrc-tauri\/latexsnipper-core$/,
)?.[1];
assert.ok(submoduleSha, "Core submodule gitlink is missing from Office HEAD");
assert.equal(submoduleSha, manifest.coreSubmoduleSha);
const skippedSubmoduleFiles = [];
for (const [file, expected] of Object.entries(manifest.files)) {
  if (!existsSync(file)) {
    assert.ok(
      file.startsWith("src-tauri/latexsnipper-core/"),
      `${file} required Office resource is missing`,
    );
    skippedSubmoduleFiles.push(file);
    continue;
  }
  const canonicalBytes = Buffer.from(
    readFileSync(file, "utf8").replaceAll("\r\n", "\n"),
    "utf8",
  );
  const actual = createHash("sha256").update(canonicalBytes).digest("hex");
  assert.equal(actual, expected, `${file} resource hash drifted`);
}

if (skippedSubmoduleFiles.length > 0) {
  console.log(
    `Core submodule is not checked out; deferred ${skippedSubmoduleFiles.length} internal resource hash to the dedicated package-resources job`,
  );
}

console.log("Office package resource contract passed OK");
