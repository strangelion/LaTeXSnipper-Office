import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../src/index.html", import.meta.url),
  "utf8",
);
const main = fs.readFileSync(
  new URL("../src/main.js", import.meta.url),
  "utf8",
);
const rustProtocol = fs.readFileSync(
  new URL("../src-tauri/src/platforms/pipe_protocol.rs", import.meta.url),
  "utf8",
);
const csharpProtocol = fs.readFileSync(
  new URL(
    "../apps/native-office/LaTeXSnipper.Shared/Protocol.cs",
    import.meta.url,
  ),
  "utf8",
);
const wordAdapter = fs.readFileSync(
  new URL(
    "../apps/native-office/LaTeXSnipper.Word/Host/WordAdapter.cs",
    import.meta.url,
  ),
  "utf8",
);

test("chapter numbering choices are enabled and have a dedicated preview value", () => {
  assert.match(html, /value="chapter-dot"/);
  assert.match(html, /value="chapter-hyphen"/);
  assert.doesNotMatch(
    html.match(
      /<div id="numberingOptions"[\s\S]*?<\/div>\s*<div class="custom-select"/,
    )?.[0] ?? "",
    /\bdisabled\b/,
  );
  assert.match(html, /id="equationNumberingPreviewValue"/);
  assert.match(main, /equationNumberingPreviewValue/);
  assert.match(main, /numberingPreview\(preference, 1, \{/);
});

test("chapter numbering metadata crosses frontend, Rust and C# protocol boundaries", () => {
  for (const field of [
    "numberingScheme",
    "numberingChapterLevel",
    "numberingSeparator",
  ]) {
    assert.match(main, new RegExp(`${field}:`));
    assert.match(rustProtocol, new RegExp(`rename = "${field}"`));
    assert.match(
      csharpProtocol,
      new RegExp(`JsonPropertyName\\("${field}"\\)`),
    );
  }
});

test("native Word emits chapter and resettable sequence fields", () => {
  assert.match(
    wordAdapter,
    /ResolveHeadingStyleName\(doc, numbering\.ChapterLevel\)/,
  );
  assert.match(wordAdapter, /STYLEREF \\"\{headingStyleName\}\\" \\\\s/);
  assert.match(wordAdapter, /SEQ LaTeXSnipperEquation \\\\s \{ChapterLevel\}/);
  assert.match(wordAdapter, /numbering\.SequenceInstruction/);
});
