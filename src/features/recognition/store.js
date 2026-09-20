// Recognition store — reactive state for the recognition workspace.

/**
 * Store shape:
 * {
 *   capabilities: { available: bool, modes: string[], outputFormats: string[] },
 *   readiness: { coreVersion, models: [], quality: [], modes: [] } | null,
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

/** EngineReadiness from the backend (null until fetched or on failure). */
let readiness = null;

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
    try {
      fn(state);
    } catch (e) {
      /* ignore */
    }
  }
}

export function getState() {
  return {
    capabilities: { ...capabilities },
    readiness,
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

export function setReadiness(value) {
  readiness = value;
  notify();
}

export function upsertJobSnapshot(snapshot) {
  const normalized = normalizeJobSnapshot(snapshot);
  const previous = jobs.get(normalized.id);
  // A delayed queued/running event must not resurrect a finished job.
  if (isTerminalJob(previous?.status) && !isTerminalJob(normalized.status)) {
    return previous;
  }
  jobs.set(normalized.id, normalized);

  // Remove from pending when terminal
  if (isTerminalJob(normalized.status)) {
    pendingJobIds.delete(normalized.id);
  }

  notify();
  return normalized;
}

export function normalizeJobSnapshot(snapshot) {
  // Rust uses camelCase; tolerate PascalCase from older desktop builds.
  const status = String(snapshot.status || "unknown");
  return { ...snapshot, status: status[0].toLowerCase() + status.slice(1) };
}

export function isTerminalJob(status) {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function setJobList(snapshots) {
  jobs.clear();
  for (const snap of snapshots) {
    const normalized = normalizeJobSnapshot(snap);
    jobs.set(normalized.id, normalized);
    if (isTerminalJob(normalized.status)) pendingJobIds.delete(normalized.id);
  }
  notify();
}

export function addPendingJob(jobId) {
  if (isTerminalJob(jobs.get(jobId)?.status)) return;
  pendingJobIds.add(jobId);
  notify();
}

export function markJobCancelRequested(jobId) {
  const job = jobs.get(jobId);
  if (job && !isTerminalJob(job.status)) {
    job.status = "cancelRequested";
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
