import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "apps/native-office/";
const scanner = readFileSync(
  `${root}LaTeXSnipper.Word/WordBatchLatexScanner.cs`,
  "utf8",
);
const executor = readFileSync(
  `${root}LaTeXSnipper.Word/WordBatchConversionExecutor.cs`,
  "utf8",
);
const adapter = readFileSync(
  `${root}LaTeXSnipper.Word/Host/WordAdapter.cs`,
  "utf8",
);
const harness = readFileSync(
  `${root}LaTeXSnipper.Word.HostTests/BatchStoriesAcceptance.cs`,
  "utf8",
);

test("Word story locators retain section and exact source positions", () => {
  assert.match(scanner, /selected\.StoryType/);
  assert.match(scanner, /selected\.InRange\(shape\.TextFrame\.TextRange\)/);
  assert.match(scanner, /\$"\{sectionIndex\}:\{\(int\)range\.StoryType\}"/);
  assert.match(
    scanner,
    /ResolveSourceRange\(range, text, match, ref searchStart\)/,
  );
  assert.match(scanner, /needle\.Replace\("\^", "\^\^"\)/);
  assert.match(scanner, /prefixText, text\.Substring\(0, match\.Offset\)/);
  assert.match(executor, /doc\.Sections\[locator\.SectionIndex\]/);
  assert.doesNotMatch(executor, /NextStoryRange/);
  assert.match(executor, /loc\.End > target\.End/);
  assert.match(
    executor,
    /originalText, item\.SourceText, StringComparison\.Ordinal/,
  );
});

test("Word batch replacement keeps source until validated story insertion", () => {
  assert.match(executor, /var anchor = source\.Duplicate/);
  assert.match(
    executor,
    /if \(!inserted\) return false;[\s\S]*source\.Delete\(\)/,
  );
  assert.doesNotMatch(executor, /target\.Text = ""/);
  assert.match(adapter, /destination = target\.Duplicate/);
  assert.match(adapter, /insertedRange = destination\.Duplicate/);
  assert.match(
    adapter,
    /if \(insertedRange != null\) insertedRange\.Delete\(\)/,
  );
  assert.match(harness, /result\.Converted == 7/);
  assert.match(harness, /saveReopenVerified = reopened/);
  assert.match(harness, /Floating shape anchor shifted the body locator/);
  assert.match(harness, /Duplicate\/Unicode\/long-formula/);
});

test("storage conversion rejects relabel-only targets and retains rendering metadata", () => {
  const conversion = adapter.slice(
    adapter.indexOf("public InsertResult ConvertFormula("),
    adapter.indexOf("private static string NormalizeOmml("),
  );
  assert.match(conversion, /targetMode != "native" && targetMode != "ole"/);
  assert.match(conversion, /UNSUPPORTED_CONVERSION_TARGET/);
  assert.match(conversion, /OMML_CONVERSION_DATA_MISSING/);
  assert.doesNotMatch(conversion, /existing\.StorageMode = "image-manifest"/);
  assert.match(conversion, /SchemaVersion = existing\.SchemaVersion/);
  assert.match(conversion, /Render = existing\.Render/);
  assert.match(conversion, /Presentation = existing\.Presentation/);
});
