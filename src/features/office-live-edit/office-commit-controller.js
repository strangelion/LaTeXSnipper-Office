/**
 * Office Commit Controller
 *
 * Manages the commit lifecycle: prepare -> commit -> await host result.
 * Uses the Rust-side RequestWaiter for reliable host confirmation.
 *
 * The commit flow:
 * 1. prepare: freeze draft in durable store
 * 2. mark_committing: transition transaction state
 * 3. send_replace_formula to host (awaited by Rust RequestWaiter)
 * 4. receive ReplaceResult with success/formulaId/revision/error
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
    this.invokeTauri =
      options.invokeTauri || (() => Promise.reject("no invoke"));
    this.onCommitSuccess = options.onCommitSuccess || (() => {});
    this.onCommitFailure = options.onCommitFailure || (() => {});
    this.onConflict = options.onConflict || (() => {});
    this._committing = false;
  }

  /**
   * Prepare a commit: freeze the draft and render the final asset.
   */
  async prepare(
    transactionId,
    draftLatex,
    displayMode,
    numbering,
    renderedAsset,
  ) {
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
   * Send the replace formula command to the host and await the result.
   *
   * The Rust side:
   * 1. Registers RequestWaiter (before send, no race)
   * 2. Sends REPLACE_FORMULA
   * 3. Awaits VstoReplaceResult with timeout
   * 4. Returns ReplaceResult { success, formulaId, revision, error }
   *
   * @returns {Promise<{success: boolean, formulaId?: string, revision?: number, error?: string}>}
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
    this._committing = true;

    try {
      // Mark transaction as committing
      await this.invokeTauri("mark_office_edit_committing", {
        transactionId,
      });

      // Call Rust — this now awaits the host result via RequestWaiter
      const result = await this.invokeTauri("native_office_replace_formula", {
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
        expectedRevision: expectedRevision ?? null,
        expectedDocumentId: expectedDocumentId || null,
      });

      // result is ReplaceResult { success, formulaId, revision, error }
      if (result.success) {
        await this.invokeTauri("complete_office_edit_transaction", {
          request: {
            transactionId,
            success: true,
            error: null,
          },
        });
        this.onCommitSuccess({
          transactionId,
          formulaId: result.formulaId || formulaId,
          revision: result.revision,
        });
        return {
          success: true,
          formulaId: result.formulaId,
          revision: result.revision,
        };
      }

      // Check for conflict
      if (result.error && result.error.includes("OFFICE_TARGET_CHANGED")) {
        await this.invokeTauri("complete_office_edit_transaction", {
          request: {
            transactionId,
            success: false,
            error: {
              errorCode: "OFFICE_TARGET_CHANGED",
              operation: "replace",
              host: "word",
              message: result.error,
            },
          },
        });
        this.onConflict({
          transactionId,
          formulaId,
          error: result.error,
        });
        return { success: false, conflict: true, error: result.error };
      }

      // Other failure
      await this.invokeTauri("complete_office_edit_transaction", {
        request: {
          transactionId,
          success: false,
          error: {
            errorCode: "HOST_COMMIT_FAILED",
            operation: "replace",
            host: "word",
            message: result.error || "Unknown error",
          },
        },
      });
      this.onCommitFailure({
        transactionId,
        formulaId,
        error: result.error,
      });
      return { success: false, error: result.error };
    } catch (err) {
      console.error("[CommitController] commit error:", err);
      return { success: false, error: err.message || String(err) };
    } finally {
      this._committing = false;
    }
  }

  /**
   * Whether a commit is currently in progress.
   */
  get isCommitting() {
    return this._committing;
  }

  dispose() {
    this._committing = false;
  }
}
