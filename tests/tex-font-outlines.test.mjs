import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import {
  bundledTexFontName,
  texGlyphPaths,
} from "../src/features/drawing/tex-font-outlines.js";

function bundledFont(name) {
  return fontkit.create(
    readFileSync(`node_modules/@rod2ik/tikzjax/dist/fonts/${name}.woff2`),
  );
}

test("TeX private-use axis digits, minus and variables produce real outlines", () => {
  for (const [name, text] of [
    ["cmr10", "\uf030\uf031\uf032\uf033\uf028\uf029"],
    ["cmsy10", "\uf0a1"],
    ["cmmi10", "\uf078\uf066"],
  ]) {
    const paths = texGlyphPaths({
      text,
      font: bundledFont(name),
      x: 12,
      y: 50,
      fontSize: 10,
    });
    assert.equal(paths.length, [...text].length);
    for (const path of paths) {
      assert.match(path.d, /^M/);
      assert.doesNotMatch(path.d + path.transform, /NaN|Infinity/);
      assert.match(path.transform, /^translate\([\d.,-]+\) scale\([\d.,-]+\)$/);
    }
    if (paths.length > 1)
      assert.notEqual(paths[0].transform, paths[1].transform);
  }
});

test("glyph path scale follows the requested TeX font size and baseline", () => {
  const font = bundledFont("cmr10");
  const run = texGlyphPaths({
    text: "\uf031",
    font,
    x: 20,
    y: 30,
    fontSize: 12,
  });
  assert.equal(
    run[0].transform,
    `translate(20,30) scale(${12 / font.unitsPerEm},${-12 / font.unitsPerEm})`,
  );
});

test("font resources cannot escape the bundled local directory", () => {
  assert.equal(bundledTexFontName("'cmr10'"), "cmr10");
  for (const name of [
    "../secret",
    "https://example.invalid/font",
    "cmr10, serif",
    "",
    "cmr10.woff2",
    "'cmr10",
    "\"cmr10'",
  ])
    assert.throws(() => bundledTexFontName(name), /TEX_FONT_NAME_UNSUPPORTED/);
});

test("missing glyphs and invalid geometry fail rather than exporting tofu", () => {
  const font = bundledFont("cmr10");
  assert.throws(
    () => texGlyphPaths({ text: "\u{10ffff}", font, x: 0, y: 0, fontSize: 10 }),
    /TEX_GLYPH_MISSING/,
  );
  for (const fontSize of [0, -2, NaN, Infinity])
    assert.throws(
      () => texGlyphPaths({ text: "\uf031", font, x: 0, y: 0, fontSize }),
      /TEX_TEXT_GEOMETRY_UNSUPPORTED/,
    );
});
