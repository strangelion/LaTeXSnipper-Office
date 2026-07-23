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
export function bindRecognitionTab() {
  if (bound) return;
  bound = true;

  console.log("[Recognition] Binding recognition tab UI...");

  store.subscribe((state) => {
    renderJobList(state.jobs);
  });

  const state = store.getState();
  renderJobList(state.jobs);
}

function renderJobList(jobList) {
  console.debug("[Recognition] Job list updated:", jobList.length, "jobs");
}
