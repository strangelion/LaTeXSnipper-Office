/**
 * Office Live Edit Bridge
 *
 * Bridges the OfficeEditController into the existing main.js editor.
 * Handles the full loop: open -> input -> preview -> commit -> feedback.
 *
 * Error recovery:
 *   - Commit failure: show toast, keep editor state, allow retry
 *   - Conflict (OFFICE_TARGET_CHANGED): show toast, re-read formula, prompt user
 *   - Rollback: on any commit failure, editor stays editable (no data loss)
 */

import { OfficeEditController } from "./office-edit-controller.js";
import { OfficeLivePreview } from "./office-live-preview.js";
import { FormulaSvgRenderer } from "../../services/formula-svg-renderer.js";

export class OfficeLiveEditBridge {
  /**
   * @param {object} options
   * @param {Function} options.invoke - Tauri invoke wrapper
   * @param {Function} options.listen - Tauri listen wrapper
   * @param {object} options.app - Reference to the main app instance
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
   * Show a toast notification via the main app.
   * Falls back to console if app doesn't have showToast.
   */
  _toast(message, type = "info") {
    if (this.app?.showToast) {
      this.app.showToast(message);
    } else if (this.app?.showStatus) {
      this.app.showStatus(message);
    } else {
      console.log(`[LiveEditBridge] ${type}: ${message}`);
    }
  }

  /**
   * Called when OPEN_EDITOR event arrives.
   */
  onOpenEditor(payload) {
    const { sessionId, action, latex, transaction, sourceHost } = payload;

    if (action === "delete" || !matchesOfficeEditAction(action)) {
      return;
    }

    if (!transaction?.transactionId) {
      console.warn("[LiveEditBridge] No transaction in OPEN_EDITOR payload");
      return;
    }

    // Dispose previous session if any
    this.dispose();

    // Create controller
    this.controller = new OfficeEditController({
      invokeTauri: this.invoke,
      listenTauri: this.listen,
      svgRenderer: this.svgRenderer,
      debounceMs: 150,
      onPreviewUpdate: (result) => {
        if (this.preview && result?.omml) {
          this.preview._handlePreviewUpdate(result);
        }
        const previewHost = document.getElementById("previewHost");
        if (previewHost && result?.svg) {
          previewHost.innerHTML = result.svg;
        }
      },
      onStateChange: (state, prev) => {
        console.debug(`[LiveEditBridge] State: ${prev} -> ${state}`);
      },
      onCommitSuccess: (result) => {
        this._toast("公式已保存到 Office", "success");
        this._active = false;
        this._clearCommitStatus();
      },
      onCommitFailure: (result) => {
        const msg = result?.error || "提交失败";
        this._toast(`保存失败: ${msg}`, "error");
        // Keep editor active so user can retry
        this._showCommitStatus("failed", msg);
      },
      onConflict: async (result) => {
        this._toast("公式已被其他操作修改，正在重新读取...", "warning");
        try {
          const fresh = await this.controller?.reReadFormula();
          if (fresh) {
            this.controller?.retryAfterConflict(fresh);
            this._toast("已重新加载公式，请检查后重新保存", "info");
          } else {
            this._toast("无法重新读取公式，请关闭后重试", "error");
          }
        } catch (e) {
          this._toast(`冲突恢复失败: ${e.message}`, "error");
        }
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
        this._showCommitStatus("ready");
        console.info(
          `[LiveEditBridge] Session started: tx=${transaction.transactionId}`,
        );
      })
      .catch((err) => {
        console.error("[LiveEditBridge] Failed to start session:", err);
        this._toast(`编辑会话启动失败: ${err.message}`, "error");
      });
  }

  /**
   * Called on every editor input (keystroke).
   */
  onInput(latex) {
    if (!this._active || !this.controller) return;
    this.controller.onInput(latex);
  }

  /**
   * Called when user clicks save/commit.
   * Returns a promise that resolves when the commit flow is complete.
   *
   * @param {object} [renderData] - Optional pre-rendered asset
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async onCommit(renderData) {
    if (!this._active || !this.controller) {
      return { success: false, error: "No active session" };
    }

    this._showCommitStatus("committing");

    try {
      const result = await this.controller.commit(renderData);
      if (result) {
        return { success: true };
      } else {
        this._showCommitStatus("failed", "Commit returned false");
        return { success: false, error: "Commit returned false" };
      }
    } catch (err) {
      this._showCommitStatus("failed", err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cancel the editing session.
   */
  async onCancel() {
    if (!this.controller) return;
    await this.controller.cancel();
    this._active = false;
    this._toast("编辑已取消", "info");
    this.controller = null;
    this.preview = null;
  }

  get isActive() {
    return this._active;
  }

  /**
   * Show commit status indicator in the UI.
   * @param {"ready"|"committing"|"failed"|"committed"} status
   * @param {string} [message]
   */
  _showCommitStatus(status, message) {
    const indicator = document.getElementById("commitStatusIndicator");
    if (!indicator) return;

    const styles = {
      ready: { color: "#4caf50", text: "Ready" },
      committing: { color: "#ff9800", text: "Saving..." },
      failed: { color: "#f44336", text: `Failed: ${message || ""}` },
      committed: { color: "#4caf50", text: "Saved" },
    };

    const s = styles[status] || styles.ready;
    indicator.style.color = s.color;
    indicator.textContent = s.text;
    indicator.style.display = "block";
  }

  _clearCommitStatus() {
    const indicator = document.getElementById("commitStatusIndicator");
    if (indicator) {
      indicator.style.display = "none";
    }
  }

  dispose() {
    this.controller?.dispose();
    this.preview?.stop();
    this._active = false;
    this.controller = null;
    this.preview = null;
    this._clearCommitStatus();
  }
}

function matchesOfficeEditAction(action) {
  return action === "insert" || action === "edit";
}
