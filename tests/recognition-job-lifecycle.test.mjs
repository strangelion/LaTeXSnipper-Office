import assert from "node:assert/strict";
import test from "node:test";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import * as store from "../src/features/recognition/store.js";
import {
  handleJobUpdate,
  startJob,
} from "../src/features/recognition/controller.js";

globalThis.window = new EventTarget();

test("Rust camelCase terminal states clear pending jobs and survive late events", () => {
  for (const status of ["completed", "failed", "cancelled", "Completed"]) {
    store.initJobStore();
    store.addPendingJob("job");
    store.upsertJobSnapshot({ id: "job", status });
    store.addPendingJob("job");
    store.upsertJobSnapshot({ id: "job", status: "running" });
    store.markJobCancelRequested("job");
    assert.equal(store.getState().pendingJobIds.size, 0);
    assert.equal(store.getState().jobs[0].status, status.toLowerCase());
  }
});

test("completed IPC event fetches the actual output once", async () => {
  store.initJobStore();
  let reads = 0;
  const results = [];
  const onResult = (event) => results.push(event.detail);
  window.addEventListener("recognition:result-ready", onResult);
  mockIPC((command) => {
    assert.equal(command, "recognition_get_output");
    reads += 1;
    return {
      success: true,
      content: "x^2",
      acceptance: { action: "manualReview" },
    };
  });
  try {
    await Promise.all(
      [1, 2].map(() =>
        handleJobUpdate({ id: "completed-job", status: "completed" }),
      ),
    );
    assert.equal(reads, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].latex, "x^2");
  } finally {
    window.removeEventListener("recognition:result-ready", onResult);
    clearMocks();
  }
});

test("completion before start response is delivered after job identity is selected", async () => {
  store.initJobStore();
  const order = [];
  const onStart = () => order.push("started");
  const onResult = () => order.push("result");
  window.addEventListener("recognition:job-started", onStart);
  window.addEventListener("recognition:result-ready", onResult);
  mockIPC(async (command) => {
    if (command === "recognition_start") {
      await handleJobUpdate({ id: "fast-job", status: "completed" });
      return { jobId: "fast-job" };
    }
    if (command === "recognition_get_job")
      return { id: "fast-job", status: "completed" };
    if (command === "recognition_get_output")
      return { success: true, content: "y" };
    throw new Error(command);
  });
  try {
    await startJob("fixture.png", "cropped-formula");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["started", "result"]);
    assert.equal(store.getState().pendingJobIds.size, 0);
  } finally {
    window.removeEventListener("recognition:job-started", onStart);
    window.removeEventListener("recognition:result-ready", onResult);
    clearMocks();
  }
});

test("failed output retrieval is surfaced instead of leaving an empty waiting result", async () => {
  store.initJobStore();
  mockIPC(() => ({ success: false, error: "MODEL_ARTIFACT_MISSING" }));
  try {
    await handleJobUpdate({ id: "output-error", status: "completed" });
    assert.equal(store.getState().jobs[0].status, "failed");
    assert.match(store.getState().jobs[0].error, /MODEL_ARTIFACT_MISSING/);
  } finally {
    clearMocks();
  }
});
