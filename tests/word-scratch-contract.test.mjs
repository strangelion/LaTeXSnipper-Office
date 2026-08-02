import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adapter = readFileSync(
  "apps/native-office/LaTeXSnipper.Word/Host/WordAdapter.cs",
  "utf8",
);
const hostTest = readFileSync(
  "apps/native-office/LaTeXSnipper.Word.HostTests/Program.cs",
  "utf8",
);

assert.match(adapter, /scratchParagraph\.Paragraphs\[1\]\.Range\.Delete\(\)/);
assert.match(adapter, /cleanup-inline-omml-scratch-paragraph/);
assert.match(adapter, /insertedProbe\.OMaths\[1\]\.Range\.Duplicate/);
assert.match(adapter, /trailing != "\\r" && trailing != "\\a"/);
assert.match(hostTest, /new\[\] \{ 1, 20, 100 \}/);
assert.match(hostTest, /document\.Content\.End != baselineContentEnd/);
assert.match(hostTest, /candidateRange\.End >= candidateParagraph\.End/);
assert.match(hostTest, /AssertNoScratchArtifacts\(document\)/);
assert.match(hostTest, /empty tail content control/);
assert.match(hostTest, /empty tail OMath/);

console.log("Word inline scratch cleanup contract passed OK");
