/**
 * Office Commit Controller
 *
 * Pure data layer — manages Tauri invoke calls and returns structured results.
 * Does NOT manage EditState transitions (that's the Controller's job).
 *
 * Commit flow:
 * 1. prepare: freeze draft in durable store
 * 2. mark_committing: transition transaction state
 * 3. send_replace_formula (awaited by Rust RequestWaiter)
 * 4. receive ReplaceResult { success, formulaId, revision, errorCode, error }
 * 5. complete: update transaction
 */

export class OfficeCommitController {
  /**
   * @param {object} options
   * @param {Function} options.invokeTauri - Tauri invoke wrapper
   */
  constructor(options = {}) {
    this.invokeTauri = options.invokeTauri || (() => Promise.reject("no invoke"));
    this._committing = false;
  }

  /**
   * Prepare a commit: freeze the draft and render the final asset.
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
   * Send the replace formula command to the host and await the result.
   *
   * Returns a structured result:
   * {
   *   success: boolean,
   *   formulaId?: string,
   *   revision?: number,
   *   actualStorageMode?: string,
   *   errorCode?: string,
   *   error?: string
   * }
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

      // Call Rust — awaits host result via RequestWaiter
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

      // Complete the transaction
      await this.invokeTauri("complete_office_edit_transaction", {
        request: {
          transactionId,
          success: result.success,
          error: result.success
            ? null
            : {
                errorCode: result.errorCode || "HOST_COMMIT_FAILED",
                operation: "replace",
                host: "word",
                message: result.error || "Unknown error",
              },
        },
      });

      return result;
    } catch (err) {
      console.error("[CommitController] commit error:", err);
      // Try to mark transaction as failed
      try {
        await this.invokeTauri("complete_office_edit_transaction", {
          request: {
            transactionId,
            success: false,
            error: {
              errorCode: "DESKTOP_ERROR",
              operation: "replace",
              host: "word",
              message: err.message || String(err),
            },
          },
        });
      } catch {
        // Best effort
      }
      return {
        success: false,
        errorCode: "DESKTOP_ERROR",
        error: err.message || String(err),
      };
    } finally {
      this._committing = false;
    }
  }

  /**
   * Re-read the formula from the host after a conflict.
   * Sends READ_FORMULA and waits for FormulaSnapshot.
   *
   * @returns {Promise<object|null>} Formula payload with updated revision
   */
  async reReadFormula(sessionId, formulaId, expectedDocumentId) {
    try {
      // Generate request ID
      const requestId = `read-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Send READ_FORMULA — result comes via native-office-formula-snapshot event
      await this.invokeTauri("native_office_read_formula_by_id", {
        sessionId,
        formulaId,
        expectedDocumentId: expectedDocumentId || null,
      });

      // Note: The actual FormulaSnapshot arrives asynchronously via Tauri events.
      // The caller should listen for native-office-formula-snapshot and correlate
      // by formulaId. For now, return a marker that re-read was initiated.
      return { requestId, formulaId, pending: true };
    } catch (err) {
      console.error("[CommitController] reReadFormula error:", err);
      return null;
    }
  }

  get isCommitting() {
    return this._committing;
  }

  dispose() {
    this._committing = false;
  }
}
