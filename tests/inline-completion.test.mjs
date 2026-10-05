import test from "node:test";
import assert from "node:assert/strict";
import { inlineCandidate } from "../src/features/formula-source/inline-completion.js";

const options = [
  { label: "\\frac{}{}", boost: 0 },
  { label: "\\sqrt{}", boost: 3 },
];
test("inline completion uses exact prefixes, local rank and explicit menu selection", () => {
  assert.equal(inlineCandidate("x+\\", "", options).option.label, "\\sqrt{}");
  assert.equal(inlineCandidate("\\sq", "", options).tail, "rt{}");
  assert.equal(
    inlineCandidate("\\", "", options, options[0]).option.label,
    "\\frac{}{}",
  );
  assert.equal(inlineCandidate("\\unknown", "", options), null);
});
test("inline completion rejects comments, escaped commands and occupied suffixes", () => {
  for (const before of ["% \\sq", "\\\\sq", "plain text"])
    assert.equal(inlineCandidate(before, "", options), null);
  for (const after of ["rt", "{}", "_{x}"])
    assert.equal(inlineCandidate("\\sq", after, options), null);
  assert.equal(inlineCandidate("\\sqrt{}", "", options), null);
});
