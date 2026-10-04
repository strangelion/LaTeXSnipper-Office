import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startOfficeBatch } from "../src/services/office-batch-runner.js";

const target = {
  host: "word",
  sessionId: "word-1",
  documentContext: "document-1",
};
const plan = {
  id: "batch-1",
  target,
  items: [{ status: "converted", sourceText: "$x$", omml: "math" }],
};
function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    async batchScanLatex(bound, scope) {
      calls.push(["scan", bound, scope]);
      return [{ source: "$x$" }];
    },
    async batchConvertPlan(bound) {
      calls.push(["plan", bound]);
      return structuredClone(plan);
    },
    async batchExecute(prepared) {
      calls.push(["execute", prepared]);
      return { total: 1, converted: 1 };
    },
    ...overrides,
  };
}
test("Office batch starts scanning immediately but writes only after confirmation", async () => {
  const api = harness();
  const progress = [];
  assert.deepEqual(
    await startOfficeBatch(target, {
      api,
      onProgress: (s) => progress.push(s),
      confirm: async () => false,
    }),
    { cancelled: true },
  );
  assert.deepEqual(
    api.calls.map(([name]) => name),
    ["scan", "plan"],
  );
  assert.equal(api.calls[0][2], "entireDocument");
  assert.equal(progress.length, 2);
  await startOfficeBatch(target, { api, confirm: async () => true });
  assert.equal(api.calls.filter(([name]) => name === "execute").length, 1);
});
test("batch confirmation cannot retarget or mutate the prepared execution plan", async () => {
  const api = harness();
  await startOfficeBatch(target, {
    api,
    confirm: async (preview) => {
      preview.target.documentContext = "another-doc";
      preview.items[0].omml = "altered";
      return true;
    },
  });
  assert.deepEqual(api.calls.at(-1)[1], plan);
});
test("batch rejects a mismatched target and never retries an uncertain mutation", async () => {
  const mismatch = harness({
    async batchConvertPlan() {
      return { ...plan, target: { ...target, sessionId: "other" } };
    },
  });
  await assert.rejects(
    startOfficeBatch(target, { api: mismatch, confirm: async () => true }),
    /目标文档/,
  );
  assert.equal(mismatch.calls.length, 1);
  let writes = 0;
  const timeout = harness({
    async batchExecute() {
      writes++;
      throw new Error("completion unknown");
    },
  });
  await assert.rejects(
    startOfficeBatch(target, { api: timeout, confirm: async () => true }),
    /unknown/,
  );
  assert.equal(writes, 1);
});
test("empty batches and missing approval do not mutate Office", async () => {
  const api = harness({
    async batchScanLatex() {
      return [];
    },
  });
  assert.equal((await startOfficeBatch(target, { api })).total, 0);
  assert.equal(api.calls.length, 0);
  const unapproved = harness();
  assert.equal(
    (await startOfficeBatch(target, { api: unapproved })).cancelled,
    true,
  );
  assert.equal(unapproved.calls.length, 2);
  await assert.rejects(
    startOfficeBatch({ ...target, documentContext: "" }, { api }),
    /文档/,
  );
});
test("COM batch route launches the job rather than scrolling to a second button", () => {
  const main = fs.readFileSync("src/main.js", "utf8");
  const method = main.slice(
    main.indexOf("  openDesktopWorkspace("),
    main.indexOf("  switchSection(", main.indexOf("  openDesktopWorkspace(")),
  );
  const Routed = new Function(`return class { ${method} }`)();
  const receiver = new Routed();
  const calls = [];
  receiver.switchSection = (section) => calls.push(section);
  receiver.runOfficeBatchConversion = (session) => calls.push(session);
  receiver.openDesktopWorkspace("batch", "source-word-session");
  assert.deepEqual(calls, ["office", "source-word-session"]);
  assert.doesNotMatch(method, /scrollIntoView/);
  assert.match(main, /_officeBatchConversionBusy/);
  assert.match(main, /session\.document_id !== expectedDocument/);
});
