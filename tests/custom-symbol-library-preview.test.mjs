import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_SYMBOL_LIBRARY_KEY,
  customSymbolPreview,
  customSymbolRenderSupport,
  findCustomSymbolBundle,
  isTrustedCustomSymbolHtmlContext,
  listCustomSymbolPreviews,
  readCustomSymbolLibrary,
} from "../src/features/custom-symbols/library-preview.js";

const svgBase64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 5h10"/></svg>',
).toString("base64");

function storageFor(value) {
  return {
    getItem(key) {
      assert.equal(key, CUSTOM_SYMBOL_LIBRARY_KEY);
      return value;
    },
  };
}

test("custom symbol library resolves an exact LaTeX command", () => {
  const bundle = {
    symbol: { name: "My symbol", latexCommand: "\\mysymbol" },
    svg: { mimeType: "image/svg+xml", dataBase64: svgBase64 },
  };
  const storage = storageFor(JSON.stringify([bundle]));
  assert.deepEqual(findCustomSymbolBundle("  \\mysymbol ", storage), bundle);
  assert.equal(findCustomSymbolBundle("x+\\mysymbol", storage), null);
  assert.equal(customSymbolPreview(bundle)?.name, "My symbol");
});

test("custom symbol preview rejects active or remote SVG content", () => {
  const unsafe = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ).toString("base64");
  assert.equal(
    customSymbolPreview({
      symbol: { latexCommand: "\\unsafe" },
      svg: { mimeType: "image/svg+xml", dataBase64: unsafe },
    }),
    null,
  );
});

test("malformed custom symbol storage degrades to an empty library", () => {
  assert.deepEqual(readCustomSymbolLibrary(storageFor("not json")), []);
  assert.deepEqual(readCustomSymbolLibrary(storageFor("{}")), []);
});

test("custom symbol render support registers MathLive and Temml macros", () => {
  const storage = storageFor(
    JSON.stringify([
      {
        symbol: { name: "My symbol", latexCommand: "\\mysymbol" },
        svg: { mimeType: "image/svg+xml", dataBase64: svgBase64 },
      },
    ]),
  );
  const previews = listCustomSymbolPreviews(storage);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].macroName, "mysymbol");
  assert.match(previews[0].className, /^latexsnipper-custom-symbol-[a-z0-9]+$/);

  const support = customSymbolRenderSupport(storage);
  assert.match(support.mathLiveMacros.mysymbol.def, /\\class\{/);
  assert.equal(support.mathLiveMacros.mysymbol.expand, false);
  assert.match(support.temmlMacros["\\mysymbol"], /\\rule\{/);
  assert.match(support.cssText, /data:image\/svg\+xml;base64,/);
  assert.match(support.cssText, /background-color:transparent!important/);
  assert.doesNotMatch(support.cssText, /javascript:|https?:/i);
});

test("Temml renders a saved custom symbol inside a mixed formula", async () => {
  const storage = storageFor(
    JSON.stringify([
      {
        symbol: { name: "My symbol", latexCommand: "\\mysymbol" },
        svg: { mimeType: "image/svg+xml", dataBase64: svgBase64 },
      },
    ]),
  );
  const support = customSymbolRenderSupport(storage);
  const module = await import("temml/dist/temml.mjs");
  const temml = module.default || module;
  const html = temml.renderToString("\\mysymbol\\frac12=", {
    macros: support.temmlMacros,
    trust: isTrustedCustomSymbolHtmlContext,
    throwOnError: false,
  });
  assert.match(html, /latexsnipper-custom-symbol-/);
  assert.doesNotMatch(html, /merror|mtext>\\mysymbol/i);
  assert.match(html, /mfrac/);
});
