/**
 * Office Live Edit Bridge
 *
 * Bridges the OfficeEditController into the existing main.js editor.
 * This is the minimal integration layer — it doesn't rewrite main.js,
 * but hooks into the existing OPEN_EDITOR / editor input / save flow.
 *
 * Usage from main.js:
 *   import { OfficeLiveEditBridge } from "./features/office-live-edit/office-live-edit-bridge.js";
 *   this._liveEditBridge = new OfficeLiveEditBridge({ invoke, listen, app: this });
 *
 *   // In OPEN_EDITOR handler:
 *   this._liveEditBridge.onOpenEditor(event.payload);
 *
 *   // In editor input handler:
 *   this._liveEditBridge.onInput(latex);
 *
 *   // In save/commit handler:
 *   await this._liveEditBridge.onCommit(renderData);
 */

import { OfficeEditController } from "./office-edit-controller.js";
import { OfficeLivePreview } from "./office-live-preview.js";
import { FormulaSvgRenderer } from "../../services/formula-svg-renderer.js";

export class OfficeLiveEditBridge {
  /**
   * @param {object} options
   * @param {Function} options.invoke - Tauri invoke wrapper
   * @param {Function} options.listen - Tauri listen wrapper
   * @param {object} options.app - Reference to the main app instance (for editor access)
   */
  constructor(options = {}) {
    this.invoke = options.invoke || (() => Promise.reject("no invoke"));
    this.listen = options.listen || (() => () => {});
    this.app = options.app;

    this.controller = null;
    this.preview = null;
    this.svgRenderer = new FormulaSvgRenderer();
    this._active = false;
  }

  /**
   * Called when OPEN_EDITOR event arrives.
   * Creates a live edit controller and starts the session.
   *
   * @param {object} payload - OPEN_EDITOR event payload
   */
  onOpenEditor(payload) {
    const { sessionId, action, latex, transaction, sourceHost } = payload;

    if (action === "delete" || !matchesOfficeEditAction(action)) {
      return; // Not an edit session
    }

    if (!transaction?.transactionId) {
      console.warn("[LiveEditBridge] No transaction in OPEN_EDITOR payload");
      return;
    }

    // Create controller
    this.controller = new OfficeEditController({
      invokeTauri: this.invoke,
      listenTauri: this.listen,
      svgRenderer: this.svgRenderer,
      debounceMs: 150,
      onPreviewUpdate: (result) => {
        // Update the preview panel
        if (this.preview && result?.omml) {
          this.preview._handlePreviewUpdate(result);
        }
        // Also update the existing previewHost if present
        const previewHost = document.getElementById("previewHost");
        if (previewHost && result?.svg) {
          previewHost.innerHTML = result.svg;
        }
      },
      onStateChange: (state, prev) => {
        console.debug(`[LiveEditBridge] State: ${prev} -> ${state}`);
      },
      onCommitSuccess: (result) => {
        console.info("[LiveEditBridge] Commit succeeded:", result);
        this._active = false;
      },
      onCommitFailure: (result) => {
        console.error("[LiveEditBridge] Commit failed:", result);
      },
      onConflict: (result) => {
        console.warn("[LiveEditBridge] Conflict:", result);
        // Re-read formula and retry
        this.controller?.reReadFormula()?.then((fresh) => {
          if (fresh) {
            this.controller?.retryAfterConflict(fresh);
          }
        });
      },
    });

    // Create preview component
    const previewHost = document.getElementById("previewHost");
    if (previewHost) {
      this.preview = new OfficeLivePreview({
        container: previewHost,
        controller: this.controller,
        svgRenderer: this.svgRenderer,
      });
      this.preview.start();
    }

    // Start the live session
    this.controller
      .open(
        transaction.transactionId,
        latex || "",
        transaction.requestedMode || "block",
        {
          sessionId,
          formulaId: transaction.formulaId,
          revision: transaction.originalRevision,
          documentId: transaction.sourceDocumentId,
          storageMode: transaction.storageMode,
          numbering: transaction.numbering,
        },
      )
      .then(() => {
        this._active = true;
        console.info(
          `[LiveEditBridge] Session started: tx=${transaction.transactionId}`,
        );
      })
      .catch((err) => {
        console.error("[LiveEditBridge] Failed to start session:", err);
      });
  }

  /**
   * Called on every editor input (keystroke).
   * Delegates to the controller's high-frequency path.
   *
   * @param {string} latex
   */
  onInput(latex) {
    if (!this._active || !this.controller) return;
    this.controller.onInput(latex);
  }

  /**
   * Called when user clicks save/commit.
   * Flushes pending render and commits to host.
   *
   * @param {object} [renderData] - Optional pre-rendered asset
   * @returns {Promise<boolean>}
   */
  async onCommit(renderData) {
    if (!this._active || !this.controller) return false;
    return this.controller.commit(renderData);
  }

  /**
   * Called when user cancels editing.
   */
  async onCancel() {
    if (!this.controller) return;
    await this.controller.cancel();
    this._active = false;
    this.controller = null;
    this.preview = null;
  }

  /**
   * Whether a live edit session is active.
   */
  get isActive() {
    return this._active;
  }

  dispose() {
    this.controller?.dispose();
    this.preview?.stop();
    this._active = false;
    this.controller = null;
    this.preview = null;
  }
}

// Re-export helpers
function matchesOfficeEditAction(action) {
  return action === "insert" || action === "edit";
}
