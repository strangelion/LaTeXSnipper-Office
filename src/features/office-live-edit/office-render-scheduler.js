/**
 * Office Render Scheduler
 *
 * Implements latest-wins semantics for real-time formula rendering.
 * Debounces input, cancels stale renders, and ensures only the most
 * recent input produces a preview.
 *
 * Design principles:
 * - Input -> debounce -> render request -> preview update
 * - New input cancels pending/in-flight renders
 * - Stale render results are silently discarded
 * - No Office object modification during preview
 */

const DEFAULT_DEBOUNCE_MS = 150;
const MAX_DEBOUNCE_MS = 500;

export class OfficeRenderScheduler {
  /**
   * @param {object} options
   * @param {number} options.debounceMs - Debounce interval (default 150ms)
   * @param {Function} options.onRenderRequest - Called when a render should execute
   * @param {Function} options.onPreviewUpdate - Called with render result
   * @param {Function} options.onStateChange - Called on scheduler state changes
   */
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || DEFAULT_DEBOUNCE_MS;
    this.onRenderRequest = options.onRenderRequest || (() => {});
    this.onPreviewUpdate = options.onPreviewUpdate || (() => {});
    this.onStateChange = options.onStateChange || (() => {});

    this._timer = null;
    this._generation = 0;
    this._inFlightGeneration = null;
    this._pendingInput = null;
    this._disposed = false;
  }

  /**
   * Submit new input. This is the high-frequency path called on every keystroke.
   * Schedules a debounced render; cancels any previous pending render.
   *
   * @param {string} latex - Current LaTeX source
   * @param {object} metadata - Additional context (displayMode, numbering, etc.)
   * @returns {number} The generation this input was assigned
   */
  submitInput(latex, metadata = {}) {
    if (this._disposed) return -1;

    this._pendingInput = { latex, metadata };

    // Cancel any pending debounce timer
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    // Schedule new debounced render
    this._timer = setTimeout(() => {
      this._flushPendingInput();
    }, this.debounceMs);

    this.onStateChange("pending");
    return this._generation;
  }

  /**
   * Force an immediate render (e.g., on focus loss or explicit save).
   */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._flushPendingInput();
  }

  /**
   * Notify that a render has started (called by the consumer).
   * Returns the generation for this render.
   */
  markRenderStarted() {
    this._generation++;
    this._inFlightGeneration = this._generation;
    this.onStateChange("inflight");
    return this._generation;
  }

  /**
   * Notify that a render completed. If the generation is stale,
   * the result should be discarded (latest-wins).
   *
   * @param {number} renderGeneration - The generation of the completed render
   * @param {object} result - Render result data
   * @returns {boolean} true if result is current, false if stale
   */
  markRenderCompleted(renderGeneration, result) {
    if (renderGeneration !== this._generation) {
      console.debug(
        `[RenderScheduler] Discarding stale render gen=${renderGeneration} (current=${this._generation})`,
      );
      return false;
    }
    this._inFlightGeneration = null;
    this.onPreviewUpdate(result);
    this.onStateChange("completed");
    return true;
  }

  /**
   * Cancel all pending and in-flight renders.
   */
  cancelAll() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pendingInput = null;
    this._inFlightGeneration = null;
    this.onStateChange("idle");
  }

  /**
   * Get current generation counter.
   */
  get generation() {
    return this._generation;
  }

  /**
   * Whether there is a pending or in-flight render.
   */
  get isBusy() {
    return this._timer !== null || this._inFlightGeneration !== null;
  }

  dispose() {
    this._disposed = true;
    this.cancelAll();
  }

  // --- Private ---

  _flushPendingInput() {
    const input = this._pendingInput;
    if (!input) return;

    this._pendingInput = null;
    this._timer = null;

    this.onRenderRequest(input.latex, input.metadata);
  }
}
