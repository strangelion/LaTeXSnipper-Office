/**
 * Office Live Edit Events
 *
 * Handles Tauri event subscriptions for real-time editing:
 * - native-office-formula-loaded (ReadSelection result)
 * - native-office-formula-snapshot (ReadFormulaById result)
 * - native-office-open-editor (OPEN_EDITOR from VSTO)
 * - native-office-error (host errors)
 * - native-office-context-changed (document switch)
 */

export class OfficeEditEvents {
  /**
   * @param {object} options
   * @param {Function} options.listenTauri - Tauri event listen wrapper
   * @param {object} options.handlers - Event handler callbacks
   */
  constructor(options = {}) {
    this.listenTauri = options.listenTauri || (() => () => {});
    this.handlers = options.handlers || {};
    this._unlisteners = [];
  }

  /**
   * Subscribe to all live edit events.
   * Returns an unsubscribe function.
   */
  subscribe() {
    const unlisten1 = this.listenTauri(
      "native-office-formula-loaded",
      (event) => {
        this.handlers.onFormulaLoaded?.(event.payload);
      },
    );
    const unlisten2 = this.listenTauri(
      "native-office-formula-snapshot",
      (event) => {
        this.handlers.onFormulaSnapshot?.(event.payload);
      },
    );
    const unlisten3 = this.listenTauri("native-office-open-editor", (event) => {
      this.handlers.onOpenEditor?.(event.payload);
    });
    const unlisten4 = this.listenTauri("native-office-error", (event) => {
      this.handlers.onError?.(event.payload);
    });
    const unlisten5 = this.listenTauri(
      "native-office-context-changed",
      (event) => {
        this.handlers.onContextChanged?.(event.payload);
      },
    );

    this._unlisteners = [
      unlisten1,
      unlisten2,
      unlisten3,
      unlisten4,
      unlisten5,
    ];

    return () => this.unsubscribe();
  }

  /**
   * Unsubscribe from all events.
   */
  unsubscribe() {
    for (const unlisten of this._unlisteners) {
      try {
        unlisten();
      } catch {
        // Already unlistened
      }
    }
    this._unlisteners = [];
  }
}
