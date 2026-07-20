/**
 * Office Live Edit - Public API
 *
 * Real-time formula editing with volatile preview + safe commit.
 *
 * Architecture:
 *   OfficeEditController
 *     ├── OfficeEditStateMachine   (UI state transitions)
 *     ├── OfficeRenderScheduler    (latest-wins, debounce, cancel)
 *     ├── OfficeCommitController   (requestId↔transactionId correlation)
 *     └── OfficeEditEvents         (Tauri event subscriptions)
 *
 *   OfficeLivePreview              (DOM preview rendering)
 */

export { OfficeEditController } from "./office-edit-controller.js";
export { OfficeEditStateMachine, EditState } from "./office-edit-state.js";
export { OfficeRenderScheduler } from "./office-render-scheduler.js";
export { OfficeCommitController } from "./office-commit-controller.js";
export { OfficeEditEvents } from "./office-edit-events.js";
export { OfficeLivePreview } from "./office-live-preview.js";
