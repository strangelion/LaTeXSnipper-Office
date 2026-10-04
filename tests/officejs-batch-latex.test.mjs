import test, { before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

let module;
before(async () => {
  const result = await build({
    entryPoints: ["apps/office-addin/src/adapters/word-batch-latex.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
});
function harness(texts, failure = -1) {
  const state = { writes: [], releases: [], tracks: [], syncs: 0 };
  const ranges = texts.map((text, index) => ({
    index,
    text,
    track() {
      state.tracks.push(index);
    },
    untrack() {
      state.releases.push(index);
    },
  }));
  const context = {
    document: {
      body: {
        paragraphs: {
          load() {},
          items: ranges.map((range) => ({
            text: range.text,
            getRange() {
              return range;
            },
          })),
        },
      },
    },
    async sync() {
      state.syncs++;
    },
  };
  globalThis.Word = {
    RangeLocation: { content: "content" },
    async run(...args) {
      return args.at(-1)(context);
    },
  };
  const controller = new module.WordBatchLatex(() => {
    let range;
    let used = false;
    return {
      async prepare(bound) {
        range = bound;
        return { source: bound.text };
      },
      async confirm() {
        used = true;
        range.untrack();
        if (range.index === failure) throw new Error("unknown host completion");
        state.writes.push(range.index);
      },
      async cancel() {
        if (range && !used) {
          range.untrack();
          used = true;
        }
      },
    };
  });
  return { controller, state };
}
test("Office.js batch only accepts explicit standalone delimited formulas", () => {
  for (const text of [
    "$x^2$",
    "$$x+1$$",
    String.raw`\(\frac{a}{b}\)`,
    String.raw`\[x=1\]`,
  ])
    assert.equal(module.isStandaloneLatex(text), true);
  for (const text of [
    "Title 2",
    "prefix $x$ suffix",
    String.raw`\frac{a}{b}`,
    "$x$ and $y$",
    "$x^{ $",
    "```$x$```",
    "$x\ny$",
  ])
    assert.equal(module.isStandaloneLatex(text), false);
});
test("in-pane batch prepares without writes, excludes fenced code and preserves exact tracked occurrences", async () => {
  const { controller, state } = harness([
    "$x$",
    "```latex",
    "$ignored$",
    "```",
    "$x$",
    "prose",
  ]);
  const plan = await controller.prepare(() => {});
  assert.equal(plan.items.length, 2);
  assert.equal(state.writes.length, 0);
  const result = await controller.execute(() => {});
  assert.equal(result.converted, 2);
  assert.deepEqual(state.writes, [4, 0]);
  assert.deepEqual(state.releases.sort(), [0, 4]);
  await assert.rejects(
    controller.execute(() => {}),
    /不会自动重试/,
  );
});
test("Office.js cancellation releases all ranges without a write", async () => {
  const { controller, state } = harness(["$x$", "$y$"]);
  await controller.prepare(() => {});
  await controller.dispose();
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.releases.sort(), [0, 1]);
  const stopped = harness(["$x$", "$y$"]);
  stopped.controller.requestStop();
  await assert.rejects(
    stopped.controller.prepare(() => {}),
    /未修改/,
  );
  assert.deepEqual(stopped.state.releases, [0, 1]);
});
test("Office.js batch retains completed items and stops on unknown commit without retry", async () => {
  const { controller, state } = harness(["$a$", "$b$", "$c$"], 1);
  await controller.prepare(() => {});
  await assert.rejects(
    controller.execute(() => {}),
    /已确认 1 条/,
  );
  assert.deepEqual(state.writes, [2]);
  assert.deepEqual(state.releases.sort(), [0, 1, 2]);
  await assert.rejects(
    controller.execute(() => {}),
    /不会自动重试/,
  );
});
test("Office.js oversized batches release prepared ranges and perform no writes", async () => {
  const { controller, state } = harness(Array(501).fill("$x$"));
  await assert.rejects(
    controller.prepare(() => {}),
    /500/,
  );
  assert.equal(state.writes.length, 0);
  assert.equal(state.releases.length, 500);
});
