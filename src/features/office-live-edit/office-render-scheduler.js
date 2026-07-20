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

    /** Resolve function for flushAndWait */
    this._flushResolve = null;
    /** Latest preview result from onPreviewUpdate */
    this._latestResult = null;
  }

  /**
   * Submit new input. This is the high-frequency path called on every keystroke.
   * Schedules a debounced render; cancels any previous pending render.
   *
   * Generation is incremented HERE (on input), not on render start.
   * This ensures any in-flight render is immediately considered stale
   * the moment new input arrives.
   *
   * @param {string} latex - Current LaTeX source
   * @param {object} metadata - Additional context (displayMode, numbering, etc.)
   * @returns {number} The generation this input was assigned
   */
  submitInput(latex, metadata = {}) {
    if (this._disposed) return -1;

    this._pendingInput = { latex, metadata };

    // Increment generation immediately on new input (Bug 6 fix).
    // This invalidates any in-flight render instantly.
    this._generation++;

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
   * Flush and wait for the render to complete.
   * Used by commit to ensure the latest preview is used.
   *
   * @param {number} timeoutMs - Max wait time (default 2000ms)
   * @returns {Promise<object|null>} The latest preview result
   */
  async flushAndWait(timeoutMs = 2000) {
    // If no pending input, nothing to render
    if (!this._pendingInput) {
      return this._latestResult;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._flushResolve = null;
        resolve(this._latestResult);
      }, timeoutMs);

      this._flushResolve = (result) => {
        clearTimeout(timer);
        this._flushResolve = null;
        resolve(result);
      };

      this.flush();
    });
  }

  /**
   * Notify that a render has started (called by the consumer).
   * Returns the generation for this render.
   */
  markRenderStarted() {
    // Generation was already incremented on input.
    // Just track which generation this render is for.
    this._inFlightGeneration = this._generation;
    this.onStateChange("inflight");
    return this._generation;
  }

  /**
   * Notify that a render completed. If the generation is stale,
   * the result is discarded (latest-wins).
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
    this._latestResult = result;
    this.onPreviewUpdate(result);
    this.onStateChange("completed");

    // Resolve any pending flushAndWait
    if (this._flushResolve) {
      this._flushResolve(result);
    }

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
