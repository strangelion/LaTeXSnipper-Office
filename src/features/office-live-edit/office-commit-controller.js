/**
 * Office Commit Controller
 *
 * Manages the commit lifecycle: prepare -> committing -> await host result -> complete.
 * Correlates requestId with transactionId for reliable result tracking.
 *
 * The commit flow:
 * 1. prepare: freeze draft, render final asset
 * 2. mark_committing: transition transaction state
 * 3. send_replace_formula to host
 * 4. await ReplaceResult from VSTO
 * 5. complete: update transaction, close live session
 */

export class OfficeCommitController {
  /**
   * @param {object} options
   * @param {Function} options.invokeTauri - Tauri invoke wrapper
   * @param {Function} options.onCommitSuccess - Called on successful commit
   * @param {Function} options.onCommitFailure - Called on failed commit
   * @param {Function} options.onConflict - Called on OFFICE_TARGET_CHANGED
   */
  constructor(options = {}) {
    this.invokeTauri = options.invokeTauri || (() => Promise.reject("no invoke"));
    this.onCommitSuccess = options.onCommitSuccess || (() => {});
    this.onCommitFailure = options.onCommitFailure || (() => {});
    this.onConflict = options.onConflict || (() => {});

    /** Maps requestId -> transactionId for correlation */
    this._pendingCommits = new Map();
    this._disposed = false;
  }

  /**
   * Prepare a commit: freeze the draft and render the final asset.
   *
   * @param {string} transactionId
   * @param {string} draftLatex
   * @param {string} displayMode
   * @param {object} numbering
   * @param {object} renderedAsset - Optional pre-rendered asset
   * @returns {Promise<object>} Prepared transaction
   */
  async prepare(transactionId, draftLatex, displayMode, numbering, renderedAsset) {
    return this.invokeTauri("prepare_office_edit_commit", {
      request: {
        transactionId,
        draftLatex,
        requestedMode: displayMode,
        numbering: numbering || null,
        renderedAsset: renderedAsset || null,
      },
    });
  }

  /**
   * Send the replace formula command to the host and track the result.
   *
   * @param {string} transactionId
   * @param {string} sessionId
   * @param {string} formulaId
   * @param {string} expectedDocumentId
   * @param {string} latex
   * @param {string} omml
   * @param {string} display
   * @param {object} renderData - SVG/PNG/dimensions
   * @param {string} storageMode
   * @param {number} expectedRevision
   * @returns {Promise<string>} requestId
   */
  async commit(
    transactionId,
    sessionId,
    formulaId,
    expectedDocumentId,
    latex,
    omml,
    display,
    renderData,
    storageMode,
    expectedRevision,
  ) {
    // Mark transaction as committing
    await this.invokeTauri("mark_office_edit_committing", {
      transactionId,
    });

    // Send replace command to host
    const requestId = await this.invokeTauri("native_office_replace_formula", {
      sessionId,
      formulaId,
      latex,
      omml,
      display,
      svg: renderData?.svg || null,
      png: renderData?.png || null,
      widthPt: renderData?.widthPt || null,
      heightPt: renderData?.heightPt || null,
      storageMode: storageMode || null,
      expectedRevision: expectedRevision || null,
      expectedDocumentId: expectedDocumentId || null,
    });

    // Track the commit
    this._pendingCommits.set(requestId, {
      transactionId,
      formulaId,
      sessionId,
      timestamp: Date.now(),
    });

    return requestId;
  }

  /**
   * Handle a ReplaceResult from the VSTO host.
   * Called when the native-office-replace-result event fires.
   *
   * @param {object} result - ReplaceResult data from VSTO
   * @returns {Promise<object>} Completion status
   */
  async handleReplaceResult(result) {
    const { requestId, success, formulaId, revision, actualStorageMode, errorCode, error } =
      result;

    const tracked = this._pendingCommits.get(requestId);
    if (!tracked) {
      console.warn(
        `[CommitController] Received result for unknown requestId: ${requestId}`,
      );
      return { handled: false };
    }

    this._pendingCommits.delete(requestId);

    if (success) {
      await this.invokeTauri("complete_office_edit_transaction", {
        request: {
          transactionId: tracked.transactionId,
          success: true,
          error: null,
        },
      });
      this.onCommitSuccess({
        transactionId: tracked.transactionId,
        formulaId: formulaId || tracked.formulaId,
        revision,
        actualStorageMode,
      });
      return { handled: true, success: true };
    }

    // Failure or conflict
    if (errorCode === "OFFICE_TARGET_CHANGED") {
      await this.invokeTauri("complete_office_edit_transaction", {
        request: {
          transactionId: tracked.transactionId,
          success: false,
          error: {
            errorCode: "OFFICE_TARGET_CHANGED",
            operation: "replace",
            host: "word",
            message: error || "Formula was modified by another operation",
          },
        },
      });
      this.onConflict({
        transactionId: tracked.transactionId,
        formulaId: tracked.formulaId,
        error,
      });
      return { handled: true, success: false, conflict: true };
    }

    // Other failure
    await this.invokeTauri("complete_office_edit_transaction", {
      request: {
        transactionId: tracked.transactionId,
        success: false,
        error: {
          errorCode: errorCode || "HOST_COMMIT_FAILED",
          operation: "replace",
          host: "word",
          message: error || "Unknown commit failure",
        },
      },
    });
    this.onCommitFailure({
      transactionId: tracked.transactionId,
      formulaId: tracked.formulaId,
      errorCode,
      error,
    });
    return { handled: true, success: false, conflict: false };
  }

  /**
   * Check if there are any pending commits.
   */
  get hasPendingCommits() {
    return this._pendingCommits.size > 0;
  }

  /**
   * Get the number of pending commits.
   */
  get pendingCount() {
    return this._pendingCommits.size;
  }

  dispose() {
    this._disposed = true;
    this._pendingCommits.clear();
  }

  /**
   * Re-read a formula from the host after a conflict.
   * Used when OFFICE_TARGET_CHANGED occurs — the user can reload the
   * current state and decide whether to retry or abort.
   *
   * @param {string} sessionId
   * @param {string} formulaId
   * @param {string} expectedDocumentId
   * @returns {Promise<object|null>} Current formula payload from host
   */
  async reReadFormula(sessionId, formulaId, expectedDocumentId) {
    if (this._disposed) return null;

    try {
      // Send read request to host
      const requestId = await this.invokeTauri("native_office_read_formula_by_id", {
        sessionId,
        formulaId,
        expectedDocumentId: expectedDocumentId || null,
      });

      // The result comes back via native-office-formula-snapshot event
      // Return the requestId so the caller can correlate
      return { requestId, formulaId };
    } catch (err) {
      console.error("[CommitController] reReadFormula failed:", err);
      return null;
    }
  }
}
