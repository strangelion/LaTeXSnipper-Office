// Recognition controller — bridges the backend events with the UI store.

import { listen } from "@tauri-apps/api/event";
import * as api from "./api.js";
import * as store from "./store.js";

/**
 * Register the Tauri event listener for recognition job updates.
 * The backend emits `recognition://job-updated` with a RecognitionJobSnapshot payload.
 */
export function registerJobUpdateListener() {
  listen("recognition://job-updated", async (event) => {
    const snapshot = event.payload;
    console.log("[Recognition] Job update:", snapshot.id, snapshot.status);
    store.upsertJobSnapshot(snapshot);

    if (snapshot.status === "Completed") {
      try {
        const output = await api.getOutput({
          jobId: snapshot.id,
          format: "latex",
        });
        if (output.success && output.content) {
          renderRecognitionResult(output.content);
        }
      } catch (err) {
        console.error("[Recognition] Failed to fetch output:", err);
      }
    }
  });
}

function renderRecognitionResult(latex) {
  const resultEl = document.getElementById("ocrResult");
  if (resultEl) resultEl.textContent = latex;
  const insertBtn = document.getElementById("ocrInsertBtn");
  if (insertBtn) insertBtn.disabled = false;
  const copyBtn = document.getElementById("ocrCopyBtn");
  if (copyBtn) copyBtn.disabled = false;
}

/**
 * Start a recognition job from a file path.
 */
export async function startJob(path, mode = "auto", options = {}) {
  const request = {
    path,
    mode,
    parseMode: options.parseMode || null,
    executionPolicy: options.executionPolicy || "async",
    modelOverrides: options.modelOverrides || null,
  };

  try {
    const response = await api.startRecognition(request);
    store.addPendingJob(response.jobId);
    return response;
  } catch (err) {
    console.error("[Recognition] Failed to start job:", err);
    throw err;
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
