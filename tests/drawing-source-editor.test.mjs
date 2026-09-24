import assert from "node:assert/strict";
import test from "node:test";

import {
  sourceLanguageName,
  summarizeSourceDiff,
} from "../src/features/drawing/source-editor.js";

test("drawing source editor labels every supported source language", () => {
  assert.equal(sourceLanguageName("svg_source"), "SVG / XML");
  assert.equal(sourceLanguageName("tikz"), "TikZ / LaTeX");
  assert.equal(sourceLanguageName("pgf_plots"), "PGFPlots / LaTeX");
  assert.equal(sourceLanguageName("graphviz_dot"), "Graphviz DOT");
  assert.equal(sourceLanguageName("mermaid"), "Mermaid");
});

test("drawing source diff reports real source additions and removals", () => {
  const summary = summarizeSourceDiff(
    "flowchart LR\nA --> B",
    "flowchart LR\nA --> C",
  );
  assert.equal(summary.changed, true);
  assert.ok(summary.changes >= 1);
  assert.ok(summary.addedCharacters > 0);
  assert.ok(summary.removedCharacters > 0);
});

test("drawing source diff stays clean for identical source", () => {
  assert.deepEqual(summarizeSourceDiff("\\draw (0,0);", "\\draw (0,0);"), {
    changed: false,
    changes: 0,
    addedCharacters: 0,
    removedCharacters: 0,
  });
});
