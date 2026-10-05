import test from "node:test";
import assert from "node:assert/strict";
import { createCompletionSelector } from "../src/features/formula-source/completion-selector.js";

const labels = ["\\frac{}{}", "\\sqrt{}", "\\sum_{}^{}"];
function store(raw = null) {
  let value = raw;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}
test("selector is opt-in, fixed on cold start, and stores no editing context", () => {
  const storage = store();
  const selector = createCompletionSelector(labels, storage);
  assert.equal(selector.enabled, false);
  assert.deepEqual(
    selector.rank().map((item) => item.boost),
    [0, 0, 0],
  );
  selector.accept(labels[1]);
  assert.equal(storage.getItem(), null);
  selector.setEnabled(true);
  selector.accept(labels[1]);
  assert.ok(selector.rank()[1].boost > selector.rank()[0].boost);
  const saved = JSON.parse(storage.getItem());
  assert.deepEqual(Object.keys(saved.entries), ["c1"]);
  assert.deepEqual(Object.keys(saved.entries.c1), ["count", "last"]);
  assert.equal(
    createCompletionSelector(labels, storage).rank()[1].boost,
    selector.rank()[1].boost,
  );
});
test("explicit undo removes feedback, reset and disabled state restore the baseline", () => {
  const storage = store();
  const selector = createCompletionSelector(labels, storage);
  selector.setEnabled(true);
  const token = selector.accept(labels[2]);
  selector.undo(token);
  assert.equal(selector.rank()[2].boost, 0);
  selector.accept(labels[2]);
  selector.setEnabled(false);
  const before = storage.getItem();
  selector.accept(labels[1]);
  assert.equal(storage.getItem(), before);
  assert.ok(selector.rank().every((item) => item.boost === 0));
  selector.reset();
  assert.equal(storage.getItem(), null);
  assert.equal(selector.enabled, false);
});
test("corruption, changed catalog, unsupported labels and unavailable storage fall back", () => {
  for (const raw of [
    "broken",
    "{}",
    JSON.stringify({ version: 1, enabled: true, sequence: -1, entries: {} }),
    "x".repeat(65537),
  ]) {
    assert.equal(createCompletionSelector(labels, store(raw)).enabled, false);
  }
  const storage = store();
  const selector = createCompletionSelector(labels, storage);
  selector.setEnabled(true);
  assert.equal(selector.accept("private user formula"), null);
  assert.equal(
    createCompletionSelector([...labels].reverse(), storage).enabled,
    false,
  );
  const inaccessible = createCompletionSelector(labels, {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("denied");
    },
  });
  inaccessible.setEnabled(true);
  inaccessible.accept(labels[1]);
  inaccessible.reset();
  assert.equal(inaccessible.enabled, false);
});
test("feedback is bounded and older undo cannot erase a newer acceptance", () => {
  const storage = store();
  const selector = createCompletionSelector(labels, storage);
  selector.setEnabled(true);
  const old = selector.accept(labels[0]);
  for (let i = 0; i < 200; i++) selector.accept(labels[0]);
  selector.undo(old);
  assert.equal(JSON.parse(storage.getItem()).entries.c0.count, 100);
  assert.ok(selector.rank()[0].boost <= 8);
});
