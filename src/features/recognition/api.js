// Recognition API layer — Tauri invoke wrappers for recognition commands.

import { invoke } from "@tauri-apps/api/core";

/**
 * Query the backend for recognition capabilities.
 */
export async function getCapabilities() {
  return invoke("recognition_get_capabilities");
}

/**
 * Start a new recognition job.
 * @param {{ path: string, mode: string, parseMode?: string, executionPolicy?: string, modelOverrides?: object }} request
 * @returns {{ jobId: string }}
 */
export async function startRecognition(request) {
  return invoke("recognition_start", { request });
}

/**
 * Get the snapshot of a single job.
 * @param {string} jobId
 * @returns {object|null}
 */
export async function getJob(jobId) {
  return invoke("recognition_get_job", { jobId });
}

/**
 * List all job snapshots.
 * @returns {object[]}
 */
export async function listJobs() {
  return invoke("recognition_list_jobs");
}

/**
 * Cancel a running job.
 * @param {string} jobId
 * @returns {boolean}
 */
export async function cancelJob(jobId) {
  return invoke("recognition_cancel", { jobId });
}

/**
 * Get the output of a completed job.
 * @param {{ jobId: string, format: string }} request
 * @returns {{ success: boolean, content?: string, error?: string }}
 */
export async function getOutput(request) {
  return invoke("recognition_get_output", { request });
}

/**
 * Export recognition result to a file.
 * @param {string} jobId
 * @param {string} format
 * @param {string} outputPath
 * @returns {string}
 */
export async function exportResult(jobId, format, outputPath) {
  return invoke("recognition_export", { jobId, format, outputPath });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * List installed models.
 * @returns {object[]}
 */
export async function listModels() {
  return invoke("model_list");
}

/**
 * Inspect a .lsmodel package.
 * @param {string} path
 * @returns {object}
 */
export async function inspectModelPackage(path) {
  return invoke("model_inspect_package", { path });
}

/**
 * Import a .lsmodel package.
 * @param {string} path
 * @returns {object}
 */
export async function importModelPackage(path) {
  return invoke("model_import_package", { path });
}

/**
 * Remove an installed model.
 * @param {string} modelId
 * @returns {object}
 */
export async function removeModel(modelId) {
  return invoke("model_remove", { modelId });
}

/**
 * Refresh model registry.
 * @returns {object}
 */
export async function refreshModels() {
  return invoke("model_refresh");
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

/**
 * List available runtimes.
 * @returns {object[]}
 */
export async function listRuntimes() {
  return invoke("runtime_list");
}

/**
 * Probe runtimes on this system.
 * @returns {object}
 */
export async function probeRuntimes() {
  return invoke("runtime_probe");
}

/**
 * Open the runtime directory in the file manager.
 * @returns {string}
 */
export async function openRuntimeDirectory() {
  return invoke("runtime_open_directory");
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

/**
 * Scan an Office document for LaTeX candidates.
 * @param {string} sessionId
 * @param {string} scope
 * @returns {object[]}
 */
export async function batchScanLatex(sessionId, scope) {
  return invoke("office_batch_scan_latex", { sessionId, scope });
}

/**
 * Build a batch conversion plan.
 * @param {object[]} candidates
 * @returns {object}
 */
export async function batchConvertPlan(candidates) {
  return invoke("office_batch_convert_plan", { candidates });
}

/**
 * Execute a batch conversion plan.
 * @param {string} sessionId
 * @param {object} plan
 * @returns {object}
 */
export async function batchExecute(sessionId, plan) {
  return invoke("office_batch_execute", { sessionId, plan });
}
