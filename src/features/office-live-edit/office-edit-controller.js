/**
 * Office Live Edit Controller
 *
 * Orchestrates the complete real-time editing experience:
 * - Binds to an OfficeEditTransaction
 * - Manages LiveOfficeEditSession (volatile in-memory state)
 * - Coordinates render scheduling (latest-wins)
 * - Handles commit lifecycle
 * - Manages UI state transitions
 *
 * Usage:
 *   const controller = new OfficeEditController({ invokeTauri, listenTauri });
 *   await controller.open(transactionId, initialLatex, displayMode);
 *   controller.onInput(latex);  // called on every keystroke
 *   await controller.commit();  // user clicks save
 *   controller.dispose();
 */

import { OfficeEditStateMachine, EditState } from "./office-edit-state.js";
import { OfficeRenderScheduler } from "./office-render-scheduler.js";
import { OfficeCommitController } from "./office-commit-controller.js";
import { OfficeEditEvents } from "./office-edit-events.js";

const DURABLE_CHECKPOINT_INTERVAL_MS = 5000;

export class OfficeEditController {
  /**
   * @param {object} options
   * @param {Function} options.invokeTauri - Tauri invoke wrapper
   * @param {Function} options.listenTauri - Tauri event listen wrapper
   * @param {Function} options.emitTauri - Tauri emit wrapper (for frontend->backend)
   * @param {number} options.debounceMs - Render debounce interval
   * @param {Function} options.onPreviewUpdate - Called with preview data
   * @param {Function} options.onStateChange - Called on state transitions
   * @param {Function} options.onCommitSuccess - Called on successful commit
   * @param {Function} options.onCommitFailure - Called on failed commit
   * @param {Function} options.onConflict - Called on conflict
   */
  constructor(options = {}) {
    this.invokeTauri =
      options.invokeTauri || (() => Promise.reject("no invoke"));
    this.listenTauri = options.listenTauri || (() => () => {});
    this.emitTauri = options.emitTauri || (() => {});

    // Core components
    this.state = new OfficeEditStateMachine((newState, prev, ctx) => {
      options.onStateChange?.(newState, prev, ctx);
    });

    this.scheduler = new OfficeRenderScheduler({
      debounceMs: options.debounceMs || 150,
      onRenderRequest: (latex, metadata) =>
        this._handleRenderRequest(latex, metadata),
      onPreviewUpdate: (result) => {
        // Store latest preview for commit
        if (result?.omml) {
          this._lastPreview = {
            latex: result.latex,
            omml: result.omml,
            svg: result.svg || null,
            widthPt: result.svgWidthPt || result.widthPt,
            heightPt: result.svgHeightPt || result.heightPt,
            displayMode: result.displayMode,
          };
        }

        // If we have OMML but no SVG yet, render SVG via MathJax
        if (result?.omml && !result.svg && this._svgRenderer) {
          this._svgRenderer
            .renderFormulaSvg(result.latex, {
              display: result.displayMode !== "inline",
            })
            .then((svgResult) => {
              result.svg = svgResult.svg;
              result.svgWidthPt = svgResult.widthPt;
              result.svgHeightPt = svgResult.heightPt;
              options.onPreviewUpdate?.(result);
            })
            .catch((err) => {
              console.warn("[LiveEdit] SVG render failed:", err);
              options.onPreviewUpdate?.(result);
            });
        } else {
          options.onPreviewUpdate?.(result);
        }
      },
      onStateChange: (s) => {
        if (s === "inflight") this.state.transition(EditState.RENDERING);
        if (
          s === "completed" &&
          this.state.canTransition(EditState.PREVIEW_READY)
        ) {
          this.state.transition(EditState.PREVIEW_READY);
        }
      },
    });

    // Callback hooks (owned by OfficeEditController, not passed to data layer)
    this._onCommitSuccess = options.onCommitSuccess || null;
    this._onCommitFailure = options.onCommitFailure || null;
    this._onConflict = options.onConflict || null;

    this.commitCtrl = new OfficeCommitController({
      invokeTauri: this.invokeTauri,
    });

    this.events = new OfficeEditEvents({
      listenTauri: this.listenTauri,
      handlers: {
        onFormulaLoaded: (payload) => this._handleFormulaLoaded(payload),
        onOpenEditor: (payload) => this._handleOpenEditor(payload),
        onError: (payload) => this._handleError(payload),
        onContextChanged: (payload) => this._handleContextChanged(payload),
      },
    });

    // Session state
    this._transactionId = null;
    this._sessionId = null;
    this._formulaId = null;
    this._revision = null;
    this._documentId = null;
    this._storageMode = null;
    this._displayMode = "block";
    this._numbering = null;
    this._lastCheckpointMs = 0;
    this._checkpointTimer = null;
    this._disposed = false;

    // SVG renderer for preview (optional, FormulaSvgRenderer instance)
    this._svgRenderer = options.svgRenderer || null;

    // Latest preview data (OMML + SVG) for commit
    this._lastPreview = null;

    // Conflict state: saved when a commit detects OFFICE_TARGET_CHANGED.
    // Holds both versions until the caller explicitly resolves.
    this._conflict = null;
  }

  /**
   * Open a live editing session for the given transaction.
   *
   * @param {string} transactionId
   * @param {string} initialLatex
   * @param {string} displayMode
   * @param {object} options - { sessionId, formulaId, revision, documentId, storageMode, numbering }
   */
  async open(transactionId, initialLatex, displayMode = "block", options = {}) {
    if (this._disposed) throw new Error("Controller is disposed");

    this._transactionId = transactionId;
    this._sessionId = options.sessionId || null;
    this._formulaId = options.formulaId || null;
    this._revision = options.revision ?? null;
    this._documentId = options.documentId || null;
    this._storageMode = options.storageMode || null;
    this._displayMode = displayMode;
    this._numbering = options.numbering || null;

    // Subscribe to backend events
    this.events.subscribe();

    // Create volatile live session in backend
    try {
      await this.invokeTauri("start_live_office_edit", {
        transactionId,
        initialLatex,
        displayMode,
        numbering: this._numbering,
      });
    } catch (err) {
      console.error("[LiveEdit] Failed to create session:", err);
      this.state.transition(EditState.FAILED, { error: err });
      throw err;
    }

    this.state.transition(EditState.READY);

    // Start periodic durable checkpoint timer
    this._startCheckpointTimer();
  }

  /**
   * Handle user input (called on every keystroke).
   * This is the high-frequency path — no disk I/O.
   *
   * @param {string} latex
   */
  onInput(latex) {
    if (this._disposed || !this._transactionId) return;
    if (!this.state.canTransition(EditState.EDITING)) return;

    this.state.transition(EditState.EDITING, { latex });

    // Update volatile session in backend
    this.invokeTauri("update_live_office_draft", {
      transactionId: this._transactionId,
      latex,
      displayMode: null, // don't change unless explicitly set
      numbering: null,
    }).catch((err) => {
      console.warn("[LiveEdit] update_draft failed:", err);
    });

    // Submit to render scheduler (debounced, latest-wins)
    this.scheduler.submitInput(latex, {
      displayMode: this._displayMode,
      numbering: this._numbering,
    });
  }

  /**
   * Set display mode and re-render.
   */
  setDisplayMode(mode) {
    this._displayMode = mode;
    if (this.state.isActive()) {
      this.scheduler.submitInput(this.scheduler._pendingInput?.latex || "", {
        displayMode: mode,
        numbering: this._numbering,
      });
    }
  }

  /**
   * Commit the edit to the host.
   *
   * @param {object} renderData - Final rendered asset { svg, png, widthPt, heightPt }
   * @returns {Promise<boolean>} true if commit succeeded
   */
  async commit(renderData = null) {
    if (this._disposed || !this._transactionId) {
      return {
        success: false,
        errorCode: "NOT_READY",
        error: "Controller disposed or no transaction",
      };
    }
    if (this.commitCtrl.isCommitting) {
      console.warn("[LiveEdit] Commit already in progress");
      return {
        success: false,
        errorCode: "ALREADY_COMMITTING",
        error: "Commit already in progress",
      };
    }

    // Flush any pending render and wait for it to complete
    await this.scheduler.flushAndWait();

    // Transition to preparing
    if (!this.state.transition(EditState.PREPARING)) {
      console.warn(
        "[LiveEdit] Cannot transition to PREPARING from",
        this.state.state,
      );
      return {
        success: false,
        errorCode: "STATE_ERROR",
        error: "Cannot transition to PREPARING",
      };
    }

    // Stop checkpoint timer
    this._stopCheckpointTimer();

    try {
      // Use latest preview data for commit (OMML + SVG)
      const preview = this._lastPreview || {};
      const finalLatex =
        preview.latex || this.scheduler._pendingInput?.latex || "";
      const finalOmml = preview.omml || "";
      const finalRenderData =
        renderData ||
        (preview.svg
          ? {
              svg: preview.svg,
              png: null,
              widthPt: preview.widthPt,
              heightPt: preview.heightPt,
            }
          : null);

      // Prepare the commit (freeze draft in durable store)
      await this.commitCtrl.prepare(
        this._transactionId,
        finalLatex,
        this._displayMode,
        this._numbering,
        finalRenderData,
      );

      // Transition to committing before calling the host
      if (!this.state.transition(EditState.COMMITTING)) {
        console.warn(
          "[LiveEdit] Cannot transition to COMMITTING from",
          this.state.state,
        );
        return {
          success: false,
          errorCode: "STATE_ERROR",
          error: "Invalid state transition",
        };
      }

      // Commit — this awaits the real host result via RequestWaiter
      const result = await this.commitCtrl.commit(
        this._transactionId,
        this._sessionId,
        this._formulaId,
        this._documentId,
        finalLatex,
        finalOmml,
        this._displayMode,
        finalRenderData,
        this._storageMode,
        this._revision,
      );

      if (result.success) {
        this.state.transition(EditState.COMMITTED);
        this._onCommitSuccess?.(result);
        this._cleanup();
      } else if (result.errorCode === "OFFICE_TARGET_CHANGED") {
        this.state.transition(EditState.CONFLICT, result);
        this._onConflict?.(result);
      } else {
        this.state.transition(EditState.FAILED, result);
        this._onCommitFailure?.(result);
      }
      return result;
    } catch (err) {
      console.error("[LiveEdit] Commit failed:", err);
      const errorResult = {
        success: false,
        errorCode: "CONTROLLER_ERROR",
        error: err.message || String(err),
      };
      this.state.transition(EditState.FAILED, errorResult);
      this._onCommitFailure?.(errorResult);
      return errorResult;
    }
  }

  /**
   * Cancel the editing session.
   */
  async cancel() {
    this.scheduler.cancelAll();
    this._stopCheckpointTimer();

    if (this._transactionId) {
      try {
        await this.invokeTauri("cancel_office_edit_transaction", {
          transactionId: this._transactionId,
        });
        await this.invokeTauri("close_live_office_edit", {
          transactionId: this._transactionId,
        });
      } catch (err) {
        console.warn("[LiveEdit] Cancel cleanup error:", err);
      }
    }

    this.events.unsubscribe();
    this._transactionId = null;
  }

  /**
   * Re-read the formula from the host after a conflict.
   * Returns the current formula state so the user can decide to retry or abort.
   *
   * @returns {Promise<object|null>} Current formula payload
   */
  async reReadFormula() {
    if (!this._sessionId || !this._formulaId) return null;

    try {
      // Rust now uses RequestWaiter — the command awaits FormulaSnapshot and
      // returns the full ReadFormulaResult directly.
      const result = await this.invokeTauri(
        "native_office_read_formula_by_id",
        {
          sessionId: this._sessionId,
          formulaId: this._formulaId,
          expectedDocumentId: this._documentId || null,
        },
      );

      if (!result.success) {
        console.warn(
          "[LiveEdit] reReadFormula failed:",
          result.errorCode,
          result.error,
        );
        return null;
      }

      return result;
    } catch (err) {
      console.error("[LiveEdit] reReadFormula error:", err);
      return null;
    }
  }

  /**
   * Prepare conflict data after a commit is rejected with OFFICE_TARGET_CHANGED.
   *
   * Saves both the user's local draft and the Office remote version WITHOUT
   * automatically choosing one. Call {@link resolveConflict} afterward to
   * explicitly pick "reload-remote" or "keep-local".
   *
   * @param {object} freshPayload - ReadFormulaResult from reReadFormula
   * @returns {object|null} conflict info { localLatex, remoteFormula, remoteLatex }
   */
  retryAfterConflict(freshPayload) {
    if (!freshPayload) return null;

    // ReadFormulaResult: { success, formulaId, formula: { formulaId, revision, storageMode, latex, ... } }
    const formula = freshPayload.formula || freshPayload;

    // Validate required fields
    if (!formula.formulaId || formula.revision == null) {
      console.warn("[LiveEdit] retryAfterConflict: invalid fresh formula data");
      return null;
    }

    // Save both versions — do NOT overwrite the editor yet
    this._conflict = {
      localLatex:
        this.scheduler._pendingInput?.latex || this._lastPreview?.latex || "",
      remoteFormula: formula,
      remoteLatex: formula.latex || "",
    };

    console.info(
      `[LiveEdit] Conflict saved: local=${this._conflict.localLatex.slice(0, 50)} remote=${this._conflict.remoteLatex.slice(0, 50)}`,
    );
    return this._conflict;
  }

  /**
   * Resolve a pending conflict with an explicit user choice.
   *
   * @param {"reload-remote"|"keep-local"} action
   *   - "reload-remote": replace editor content with Office version
   *   - "keep-local": keep user's draft, update revision to Office version
   * @returns {boolean} true if resolved successfully
   */
  resolveConflict(action) {
    if (!this._conflict) {
      console.warn("[LiveEdit] resolveConflict: no pending conflict");
      return false;
    }

    if (action !== "reload-remote" && action !== "keep-local") {
      console.warn(`[LiveEdit] resolveConflict: unknown action "${action}"`);
      return false;
    }

    const { remoteFormula, remoteLatex } = this._conflict;

    // Update identity to Office version so re-commit won't conflict again
    this._formulaId = remoteFormula.formulaId;
    this._revision = remoteFormula.revision;
    this._storageMode = remoteFormula.storageMode || this._storageMode;

    if (action === "reload-remote") {
      // Transition to READY first so onInput (which requires EDITING) can fire.
      // CONFLICT → EDITING is not allowed by the state machine.
      if (this.state.state === EditState.CONFLICT) {
        this.state.transition(EditState.READY);
      }

      // Replace editor content with Office version
      if (remoteLatex && this.state.canTransition(EditState.EDITING)) {
        this.onInput(remoteLatex);
      }

      this._conflict = null;
      console.info(
        `[LiveEdit] Conflict resolved (reload-remote): formulaId=${this._formulaId} rev=${this._revision}`,
      );
      return true;
    }

    // "keep-local": retain local draft, just bump revision
    this._conflict = null;
    if (this.state.state === EditState.CONFLICT) {
      this.state.transition(EditState.READY);
    }
    console.info(
      `[LiveEdit] Conflict resolved (keep-local): formulaId=${this._formulaId} rev=${this._revision}`,
    );
    return true;
  }

  /**
   * The current conflict data, if any.
   * @type {{ localLatex: string, remoteFormula: object, remoteLatex: string } | null}
   */
  get conflict() {
    return this._conflict;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this.scheduler.dispose();
    this.commitCtrl.dispose();
    this.events.unsubscribe();
    this._stopCheckpointTimer();

    if (this._transactionId) {
      this.invokeTauri("close_live_office_edit", {
        transactionId: this._transactionId,
      }).catch(() => {});
    }
  }

  /**
   * Get a snapshot of the current session state.
   */
  getSnapshot() {
    return {
      transactionId: this._transactionId,
      state: this.state.state,
      latex: this.scheduler._pendingInput?.latex || "",
      displayMode: this._displayMode,
      renderGeneration: this.scheduler.generation,
      formulaId: this._formulaId,
      revision: this._revision,
      storageMode: this._storageMode,
      documentId: this._documentId,
    };
  }

  /**
   * Get the latest preview data for commit.
   * Returns the most recently rendered OMML and SVG.
   */
  getPreviewData() {
    return this._lastPreview || null;
  }

  // --- Private event handlers ---

  _handleRenderRequest(latex, metadata) {
    if (this._disposed) return;

    const gen = this.scheduler.markRenderStarted();

    // Call backend: LaTeX -> OMML conversion (fast, single formula)
    this.invokeTauri("render_live_preview", {
      latex,
      displayMode: metadata.displayMode || this._displayMode,
    })
      .then((preview) => {
        if (preview.success) {
          this.scheduler.markRenderCompleted(gen, {
            latex,
            omml: preview.omml,
            widthPt: preview.widthPt,
            heightPt: preview.heightPt,
            displayMode: preview.displayMode,
          });
        } else {
          console.warn("[LiveEdit] Preview render failed:", preview.error);
          this.scheduler.markRenderCompleted(gen, {
            latex,
            omml: null,
            error: preview.error,
          });
        }
      })
      .catch((err) => {
        console.warn("[LiveEdit] Render request failed:", err);
        this.scheduler.markRenderCompleted(gen, null);
      });
  }

  _handleFormulaLoaded(payload) {
    if (payload.sessionId !== this._sessionId) return;
    if (!payload.formula) return;

    const formula = payload.formula;
    this._formulaId = formula.formulaId;
    this._revision = formula.revision;
    this._storageMode = formula.storageMode;
    this._documentId = payload.documentContextId || this._documentId;

    console.info(
      `[LiveEdit] Formula loaded: ${this._formulaId} rev=${this._revision} mode=${this._storageMode}`,
    );
  }

  _handleOpenEditor(payload) {
    if (payload.transaction) {
      console.info(
        "[LiveEdit] OPEN_EDITOR with transaction:",
        payload.transaction,
      );
    }
  }

  _handleError(payload) {
    console.error("[LiveEdit] Host error:", payload);
    if (payload.errorCode === "OFFICE_TARGET_CHANGED") {
      this.state.transition(EditState.CONFLICT, payload);
    }
  }

  _handleContextChanged(payload) {
    console.info("[LiveEdit] Document context changed:", payload);
    if (this._documentId && payload.documentContextId !== this._documentId) {
      this.state.transition(EditState.CONFLICT, {
        reason: "document_changed",
        expected: this._documentId,
        actual: payload.documentContextId,
      });
    }
  }

  // --- Durable checkpoint ---

  _startCheckpointTimer() {
    this._stopCheckpointTimer();
    this._checkpointTimer = setInterval(() => {
      this._tryCheckpoint();
    }, DURABLE_CHECKPOINT_INTERVAL_MS);
  }

  _stopCheckpointTimer() {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }
  }

  async _tryCheckpoint() {
    if (this._disposed || !this._transactionId) return;

    const now = Date.now();
    if (now - this._lastCheckpointMs < DURABLE_CHECKPOINT_INTERVAL_MS) return;

    try {
      const needsCheckpoint = await this.invokeTauri(
        "get_live_office_snapshot", // Use snapshot to check dirty state
        { transactionId: this._transactionId },
      );

      if (needsCheckpoint?.dirty) {
        // Sync dirty state to durable store
        await this.invokeTauri("update_office_edit_draft", {
          request: {
            transactionId: this._transactionId,
            draftLatex: needsCheckpoint.currentLatex,
            requestedMode: this._displayMode,
            numbering: this._numbering,
          },
        });
        this._lastCheckpointMs = now;

        // Clear dirty flag
        // The backend handles this internally
      }
    } catch (err) {
      console.warn("[LiveEdit] Checkpoint failed:", err);
    }
  }

  _cleanup() {
    this._stopCheckpointTimer();
    this.events.unsubscribe();
  }
}
