// Recognition feature — entry point for the OCR/document recognition workspace.
// Initialized via main.js:
//   import { initRecognitionWorkspace } from "./features/recognition/index.js";
//   await initRecognitionWorkspace();

import * as api from "./api.js";
import * as controller from "./controller.js";
import * as store from "./store.js";
import * as view from "./view.js";

export { api, controller, store, view };

/**
 * Initialize the recognition workspace.
 *
 * This attaches the recognition subsystem to the application lifecycle:
 * - Registers Tauri event listeners (recognition://job-updated)
 * - Wires up UI bindings
 * - Initializes the job store
 *
 * Does NOT trigger RecognitionService creation (lazy).
 */
export async function initRecognitionWorkspace() {
  console.log("[Recognition] Initializing recognition workspace...");

  // Initialize job store
  store.initJobStore();

  // Listen for job updates from the backend
  controller.registerJobUpdateListener();

  // Wire up UI elements if the recognition tab exists
  if (view.hasRecognitionTab()) {
    view.bindRecognitionTab(controller);
  }

  // Check backend capabilities
  try {
    const caps = await api.getCapabilities();
    console.log("[Recognition] Backend capabilities:", caps);
    store.setCapabilities(caps);
  } catch (err) {
    console.warn("[Recognition] Recognition not available:", err);
    store.setCapabilities({ available: false, modes: [], outputFormats: [], maxResolution: null, activeJobs: 0 });
  }

  console.log("[Recognition] Workspace initialized.");
}
