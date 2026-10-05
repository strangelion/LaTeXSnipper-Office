import test from "node:test";
import assert from "node:assert/strict";
import { contextCompletions } from "../src/features/formula-source/context-completions.js";

test("candidate catalog expands and changes with integrals, derivatives and environments", () => {
  const plain = contextCompletions("", []);
  assert.ok(plain.length > 70);
  const integral = contextCompletions("\\int_0^1 f(x)", []);
  assert.ok(
    integral.find((option) => option.label === "\\mathrm{d}x").boost > 0,
  );
  assert.ok(!plain.some((option) => option.label === "\\mathrm{d}x"));
  const nested = contextCompletions(
    "\\begin{aligned}\\begin{matrix}x\\end{matrix}",
    [],
  );
  assert.equal(
    nested.find((option) => option.detail === "闭合当前环境").label,
    "\\end{aligned}",
  );
  assert.ok(
    !contextCompletions("% \\int\n x", []).some(
      (option) => option.label === "\\mathrm{d}x",
    ),
  );
});
test("reuse only known commands and explicitly validated symbol candidates", () => {
  const options = contextCompletions(
    "\\sin(x) + \\unknown",
    [],
    [{ label: "\\mysymbol", name: "Saved" }, { label: "bad{source}" }],
  );
  assert.ok(options.find((option) => option.label === "\\sin").boost > 0);
  assert.ok(options.find((option) => option.label === "\\mysymbol"));
  assert.ok(
    !options.some(
      (option) =>
        option.label.includes("unknown") || option.label === "bad{source}",
    ),
  );
  assert.ok(options.some((option) => option.label === "^{2}"));
});
