import assert from "node:assert/strict";
import test from "node:test";
import {
  numberingPreview,
  resolveNumberingPreference,
  validateNumberingTemplate,
} from "../src/features/formula-numbering.js";

test("equation numbering presets cover common academic styles", () => {
  assert.equal(numberingPreview({ preset: "parenthesized" }), "(1)");
  assert.equal(numberingPreview({ preset: "bracketed" }), "[1]");
  assert.equal(numberingPreview({ preset: "dotted" }), "1.");
  assert.equal(numberingPreview({ preset: "equation" }), "式 1");
  assert.equal(numberingPreview({ preset: "roman" }, 4), "(IV)");
  assert.equal(numberingPreview({ preset: "alphabetic" }, 3), "(C)");
});

test("custom numbering requires one bounded placeholder", () => {
  assert.equal(validateNumberingTemplate("公式（{n}）"), "");
  assert.match(validateNumberingTemplate("公式 1"), /一个 \{n\}/);
  assert.match(validateNumberingTemplate("{n}-{n}"), /一个 \{n\}/);
  assert.equal(
    resolveNumberingPreference({ preset: "custom", template: "公式（{n}）" })
      .template,
    "公式（{n}）",
  );
});

test("chapter numbering previews preserve scheme and number style", () => {
  assert.equal(
    numberingPreview({ preset: "parenthesized" }, 1, {
      scheme: "chapter-dot",
      chapter: 2,
    }),
    "(2.1)",
  );
  assert.equal(
    numberingPreview({ preset: "roman" }, 4, {
      scheme: "chapter-hyphen",
      chapter: 3,
    }),
    "(3-IV)",
  );
});
