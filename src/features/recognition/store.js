// Recognition store — reactive state for the recognition workspace.

/**
 * Store shape:
 * {
 *   capabilities: { available: bool, modes: string[], outputFormats: string[] },
 *   jobs: Map<string, JobSnapshot>,
 *   selectedJobId: string | null,
 *   pendingJobIds: Set<string>,
 * }
 */

let capabilities = {
  available: false,
  modes: [],
  outputFormats: [],
  maxResolution: null,
  activeJobs: 0,
};

/** @type {Map<string, object>} */
const jobs = new Map();

let selectedJobId = null;

/** @type {Set<string>} */
const pendingJobIds = new Set();

/** @type {Array<Function>} */
const listeners = [];

function notify() {
  const state = getState();
  for (const fn of listeners) {
    try { fn(state); } catch (e) { /* ignore */ }
  }
}

export function getState() {
  return {
    capabilities: { ...capabilities },
    jobs: Array.from(jobs.values()),
    selectedJobId,
    pendingJobIds: new Set(pendingJobIds),
  };
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function initJobStore() {
  jobs.clear();
  pendingJobIds.clear();
  selectedJobId = null;
}

export function setCapabilities(caps) {
  capabilities = { ...caps };
  notify();
}

export function upsertJobSnapshot(snapshot) {
  jobs.set(snapshot.id, { ...snapshot });

  // Remove from pending when terminal
  if (["Completed", "Failed", "Cancelled"].includes(snapshot.status)) {
    pendingJobIds.delete(snapshot.id);
  }

  notify();
}

export function setJobList(snapshots) {
  jobs.clear();
  for (const snap of snapshots) {
    jobs.set(snap.id, { ...snap });
  }
  notify();
}

export function addPendingJob(jobId) {
  pendingJobIds.add(jobId);
  notify();
}

export function markJobCancelRequested(jobId) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = "CancelRequested";
    job.message = "Cancelling...";
    notify();
  }
}

export function selectJob(jobId) {
  selectedJobId = jobId;
  notify();
}

export function hasRecognitionTab() {
  return true; // The recognition tab is always available in this build
}
