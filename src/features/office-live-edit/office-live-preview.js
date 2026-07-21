/**
 * Office Live Preview Component
 *
 * Renders the live preview of a formula being edited.
 * Connects the OfficeEditController to the DOM preview element.
 *
 * This is the "last mile" of P2 — wiring the render pipeline output
 * to the actual UI display.
 *
 * Usage:
 *   const preview = new OfficeLivePreview({
 *     container: document.getElementById("previewHost"),
 *     controller: liveEditController,
 *     svgRenderer: formulaSvgRenderer,
 *   });
 *   preview.start();
 */

import { FormulaSvgRenderer } from "../../services/formula-svg-renderer.js";

export class OfficeLivePreview {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container - DOM element to render preview into
   * @param {object} options.controller - OfficeEditController instance
   * @param {FormulaSvgRenderer} [options.svgRenderer] - SVG renderer (auto-created if not provided)
   * @param {string} [options.placeholder] - Placeholder text when empty
   * @param {string} [options.errorClass] - CSS class for error state
   */
  constructor(options = {}) {
    this.container = options.container;
    this.controller = options.controller;
    this.svgRenderer = options.svgRenderer || new FormulaSvgRenderer();
    this.placeholder =
      options.placeholder ||
      '<span style="color: var(--muted);">输入公式后预览</span>';
    this.errorClass = options.errorClass || "preview-error";

    this._rendering = false;
    this._lastLatex = null;
    this._lastSvg = null;
    this._initialized = false;
  }

  /**
   * Start listening to controller preview updates.
   */
  start() {
    if (this._initialized) return;
    if (!this.container || !this.controller) {
      console.warn("[LivePreview] Missing container or controller");
      return;
    }

    // Override controller's onPreviewUpdate to include SVG rendering
    const originalOnPreviewUpdate = this.controller._options?.onPreviewUpdate;
    this.controller._options = this.controller._options || {};
    this.controller._options.onPreviewUpdate = (result) => {
      this._handlePreviewUpdate(result);
      originalOnPreviewUpdate?.(result);
    };

    // Show initial placeholder
    this._showPlaceholder();
    this._initialized = true;
  }

  /**
   * Stop listening and clear preview.
   */
  stop() {
    this._initialized = false;
    this._showPlaceholder();
  }

  /**
   * Manually update the preview with new LaTeX.
   * Bypasses the controller for direct updates.
   *
   * @param {string} latex
   * @param {object} [options] - { display: boolean }
   */
  async updateManual(latex, options = {}) {
    if (!this.container) return;

    if (!latex || !latex.trim()) {
      this._showPlaceholder();
      return;
    }

    this._rendering = true;
    this._showRendering();

    try {
      const display = options.display !== false;
      const svgResult = await this.svgRenderer.renderFormulaSvg(latex, {
        display,
      });
      this._lastLatex = latex;
      this._lastSvg = svgResult.svg;
      this._renderSvg(svgResult.svg, svgResult.widthPt, svgResult.heightPt);
    } catch (err) {
      this._showError(err.message || "渲染失败");
    } finally {
      this._rendering = false;
    }
  }

  /**
   * Get the last rendered SVG.
   */
  get lastSvg() {
    return this._lastSvg;
  }

  /**
   * Get the last rendered LaTeX.
   */
  get lastLatex() {
    return this._lastLatex;
  }

  /**
   * Whether a render is in progress.
   */
  get isRendering() {
    return this._rendering;
  }

  // --- Private ---

  _handlePreviewUpdate(result) {
    if (!this.container) return;

    if (result?.error && !result?.omml) {
      this._showError(result.error);
      return;
    }

    if (result?.latex === this._lastLatex && result?.svg) {
      // Same LaTeX, already rendered — just update display
      this._lastSvg = result.svg;
      this._renderSvg(
        result.svg,
        result.svgWidthPt || result.widthPt,
        result.svgHeightPt || result.heightPt,
      );
      return;
    }

    // New LaTeX — render SVG
    if (result?.latex && result.latex.trim()) {
      this._rendering = true;
      this._showRendering();

      const display = result.displayMode !== "inline";
      this.svgRenderer
        .renderFormulaSvg(result.latex, { display })
        .then((svgResult) => {
          this._lastLatex = result.latex;
          this._lastSvg = svgResult.svg;
          this._renderSvg(svgResult.svg, svgResult.widthPt, svgResult.heightPt);
        })
        .catch((err) => {
          console.warn("[LivePreview] SVG render failed:", err);
          this._showError(err.message || "渲染失败");
        })
        .finally(() => {
          this._rendering = false;
        });
    } else {
      this._showPlaceholder();
    }
  }

  _renderSvg(svg, _widthPt, _heightPt) {
    if (!this.container) return;
    this.container.innerHTML = "";
    this.container.classList.remove(this.errorClass);

    const wrapper = document.createElement("div");
    wrapper.className = "live-preview-svg";
    wrapper.style.cssText =
      "display: flex; align-items: center; justify-content: center; min-height: 2em;";
    wrapper.innerHTML = svg;
    this.container.appendChild(wrapper);
  }

  _showPlaceholder() {
    if (!this.container) return;
    this.container.innerHTML = this.placeholder;
    this.container.classList.remove(this.errorClass);
  }

  _showRendering() {
    if (!this.container) return;
    // Keep current content visible while rendering, just add a subtle indicator
    const indicator = document.createElement("span");
    indicator.className = "live-preview-indicator";
    indicator.style.cssText =
      "opacity: 0.3; font-size: 0.8em; margin-left: 0.5em;";
    indicator.textContent = "...";
    // Don't clear existing content — just show indicator
  }

  _showError(message) {
    if (!this.container) return;
    this.container.classList.add(this.errorClass);
    this.container.innerHTML = `<span style="color: var(--error, #e74c3c); font-size: 0.9em;">${this._escapeHtml(message)}</span>`;
  }

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
