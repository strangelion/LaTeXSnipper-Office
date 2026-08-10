import assert from "node:assert/strict";
import test from "node:test";
import {
  formulaCopyPlan,
  shouldPreserveNativeCopy,
} from "../src/features/clipboard/formula-copy.js";

test("smart formula copy requests the native multi-format profile", () => {
  const plan = formulaCopyPlan("smart");
  assert.equal(plan.profile, "smart");
  assert.equal(plan.requestedFormats, null);
  assert.equal(plan.renderSvg, true);
  assert.equal(plan.renderPng, true);
});

test("explicit formula copy buttons retain exact format intent", () => {
  assert.deepEqual(formulaCopyPlan("latex").requestedFormats, ["text/plain"]);
  assert.deepEqual(formulaCopyPlan("mathml").requestedFormats, [
    "application/mathml+xml",
  ]);
  assert.deepEqual(formulaCopyPlan("svg").requestedFormats, ["image/svg+xml"]);
  assert.deepEqual(formulaCopyPlan("md").requestedFormats, ["text/markdown"]);
  assert.deepEqual(formulaCopyPlan("omml").requestedFormats, [
    "application/vnd.latexsnipper.omml+xml",
  ]);
});

test("copy shortcut ignores modified and non-copy key combinations", () => {
  const event = {
    defaultPrevented: false,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    key: "c",
    target: null,
  };
  assert.equal(shouldPreserveNativeCopy(event, null), true);
  assert.equal(
    shouldPreserveNativeCopy({ ...event, shiftKey: false }, null),
    false,
  );
});

test("copy shortcut preserves an existing document selection", () => {
  const event = {
    defaultPrevented: false,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: "c",
    target: null,
  };
  const selection = { isCollapsed: false, toString: () => "selected text" };
  assert.equal(shouldPreserveNativeCopy(event, selection), true);
});
