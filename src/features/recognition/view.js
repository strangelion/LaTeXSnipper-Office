// Recognition view — UI bindings for the recognition workspace tab.

import * as store from "./store.js";

let bound = false;

export function hasRecognitionTab() {
  return true;
}

/**
 * Bind the recognition workspace tab to the controller.
 * Called once during initialization if the tab exists.
 */
export function bindRecognitionTab(controller) {
  if (bound) return;
  bound = true;

  console.log("[Recognition] Binding recognition tab UI...");

  // Subscribe to store changes
  store.subscribe((state) => {
    renderJobList(state.jobs, state.selectedJobId);
  });

  // Render the job list initially
  const state = store.getState();
  renderJobList(state.jobs, state.selectedJobId);
}

/**
 * Render the job list in the DOM.
 * This is a minimal implementation — the full UI uses Svelte/React components.
 */
function renderJobList(jobList, selectedJobId) {
  // Placeholder: the actual rendering is handled by the Svelte/React frontend.
  // This function can be replaced when the UI framework is chosen.
  console.debug("[Recognition] Job list updated:", jobList.length, "jobs");
}
