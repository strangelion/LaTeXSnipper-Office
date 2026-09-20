// Recognition controller — bridges the backend events with the UI store.

import { listen } from "@tauri-apps/api/event";
import * as api from "./api.js";
import * as store from "./store.js";

let startsInFlight = 0;
const outputsInFlight = new Map();
const deliveredOutputs = new Set();

/**
 * Register the Tauri event listener for recognition job updates.
 * The backend emits `recognition://job-updated` with a RecognitionJobSnapshot payload.
 */
export function registerJobUpdateListener() {
  if (!globalThis.window?.__TAURI_INTERNALS__) return Promise.resolve(() => {});
  return listen("recognition://job-updated", (event) =>
    handleJobUpdate(event.payload),
  );
}

export async function handleJobUpdate(payload) {
  const snapshot = store.upsertJobSnapshot(payload);
  console.log("[Recognition] Job update:", snapshot.id, snapshot.status);
  if (
    snapshot.status === "completed" &&
    !startsInFlight &&
    !deliveredOutputs.has(snapshot.id)
  ) {
    if (outputsInFlight.has(snapshot.id))
      return outputsInFlight.get(snapshot.id);
    const pending = (async () => {
      try {
        const output = await api.getOutput({
          jobId: snapshot.id,
          format: "latex",
        });
        if (output.success && output.content) {
          deliveredOutputs.add(snapshot.id);
          renderRecognitionResult(
            snapshot.id,
            output.content,
            output.acceptance,
          );
        } else {
          throw new Error(output.error || "识别完成，但没有返回可用结果");
        }
      } catch (err) {
        console.error("[Recognition] Failed to fetch output:", err);
        store.upsertJobSnapshot({
          ...snapshot,
          status: "failed",
          error: `读取识别结果失败：${err.message || err}`,
        });
      } finally {
        outputsInFlight.delete(snapshot.id);
      }
    })();
    outputsInFlight.set(snapshot.id, pending);
    return pending;
  }
}

function renderRecognitionResult(jobId, latex, acceptance) {
  // UIController owns selected-job checks, visible output and auto-insertion.
  window.dispatchEvent(
    new CustomEvent("recognition:result-ready", {
      detail: { jobId, latex, acceptance },
    }),
  );
}

/**
 * Start a recognition job from a file path.
 */
export async function startJob(path, mode = "auto", options = {}) {
  const request = {
    path,
    mode,
    inputKind: options.inputKind || null,
    parseMode: options.parseMode || null,
    executionPolicy: options.executionPolicy || "async",
    modelOverrides: options.modelOverrides || null,
  };

  startsInFlight += 1;
  try {
    const response = await api.startRecognition(request);
    store.addPendingJob(response.jobId);
    store.selectJob(response.jobId);
    window.dispatchEvent(
      new CustomEvent("recognition:job-started", { detail: response }),
    );
    // Reconcile lost/early events without turning a polling failure into a
    // failed start (which would encourage duplicate recognition submissions).
    void api
      .getJob(response.jobId)
      .then((snapshot) => {
        if (snapshot) return handleJobUpdate(snapshot);
      })
      .catch((error) =>
        console.warn("[Recognition] Snapshot refresh failed:", error),
      );
    return response;
  } catch (err) {
    console.error("[Recognition] Failed to start job:", err);
    throw err;
  } finally {
    startsInFlight -= 1;
    if (!startsInFlight) {
      for (const snapshot of store.getState().jobs) {
        if (snapshot.status === "completed") void handleJobUpdate(snapshot);
      }
    }
  }
}

/**
 * Request cancellation for a running job.
 */
export async function cancelJob(jobId) {
  try {
    const result = await api.cancelJob(jobId);
    store.markJobCancelRequested(jobId);
    return result;
  } catch (err) {
    console.error("[Recognition] Failed to cancel job:", err);
    throw err;
  }
}

/**
 * Fetch the output of a completed job.
 */
export async function getJobOutput(jobId, format = "latex") {
  try {
    const result = await api.getOutput({ jobId, format });
    return result;
  } catch (err) {
    console.error("[Recognition] Failed to get output:", err);
    throw err;
  }
}

/**
 * Refresh the list of all jobs.
 */
export async function refreshJobs() {
  try {
    const jobs = await api.listJobs();
    store.setJobList(jobs);
  } catch (err) {
    console.error("[Recognition] Failed to list jobs:", err);
  }
}
