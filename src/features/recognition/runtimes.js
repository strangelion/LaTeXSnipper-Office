// Runtime management UI helpers.

import * as api from "../api.js";

/**
 * List available runtimes.
 */
export async function listRuntimes() {
  try {
    return await api.listRuntimes();
  } catch (err) {
    console.error("[Runtimes] Failed to list:", err);
    return [];
  }
}

/**
 * Probe runtimes on this system.
 */
export async function probeRuntimes() {
  return api.probeRuntimes();
}

/**
 * Open the runtime directory in the system file manager.
 */
export async function openRuntimeDirectory() {
  return api.openRuntimeDirectory();
}
