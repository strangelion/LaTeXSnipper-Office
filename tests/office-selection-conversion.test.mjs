import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareSelectionConversion,
  executeSelectionConversion,
} from "../src/services/office-selection-conversion.js";

const target = { host: "word", sessionId: "word-1", documentContext: "doc-1" };
const candidate = {
  source: String.raw`\frac{a}{b}`,
  locator: { kind: "wordRange", start: 10, end: 21 },
};
const plan = {
  target,
  items: [
    {
      sourceText: candidate.source,
      normalizedLatex: candidate.source,
      locator: candidate.locator,
      sourceHash: "hash",
      status: "converted",
      omml: "<m:oMath/>",
    },
  ],
};
function apiWith(overrides = {}) {
  const calls = [];
  return {
    calls,
    async batchScanLatex(t, scope) {
      calls.push(["scan", t, scope]);
      return [candidate];
    },
    async batchConvertPlan(t, candidates) {
      calls.push(["plan", t, candidates]);
      return structuredClone(plan);
    },
    async batchExecute(p) {
      calls.push(["execute", p]);
      return { total: 1, converted: 1 };
    },
    ...overrides,
  };
}

test("raw Word selection prepares a bound plan without a write, cancel never executes", async () => {
  const api = apiWith();
  const prepared = await prepareSelectionConversion(target, api);
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0][2], "selection-latex");
  assert.deepEqual(await executeSelectionConversion(prepared, false, api), {
    cancelled: true,
  });
  assert.equal(api.calls.length, 2);
  assert.equal(
    (await executeSelectionConversion(prepared, true, api)).converted,
    1,
  );
  assert.deepEqual(api.calls[2][1], prepared);
});

test("selection preparation rejects failed, ambiguous, unsafe and wrong-document plans", async () => {
  for (const invalid of [
    { ...plan, items: [] },
    { ...plan, items: [plan.items[0], plan.items[0]] },
    {
      ...plan,
      items: [{ ...plan.items[0], status: "failed", error: "unknown macro" }],
    },
    { ...plan, items: [{ ...plan.items[0], sourceHash: null }] },
    { ...plan, items: [{ ...plan.items[0], sourceText: "other" }] },
    { ...plan, target: { ...target, documentContext: "other-doc" } },
  ]) {
    const api = apiWith({
      async batchConvertPlan() {
        return invalid;
      },
    });
    await assert.rejects(prepareSelectionConversion(target, api));
    assert.ok(api.calls.every((call) => call[0] !== "execute"));
  }
  await assert.rejects(
    prepareSelectionConversion({ ...target, host: "excel" }, apiWith()),
  );
  await assert.rejects(
    prepareSelectionConversion(
      target,
      apiWith({
        async batchScanLatex() {
          return [];
        },
      }),
    ),
  );
});
