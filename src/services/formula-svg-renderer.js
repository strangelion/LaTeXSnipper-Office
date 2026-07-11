/**
 * FormulaSvgRenderer — Unified formula SVG rendering service.
 *
 * Uses MathJax tex-svg for all formula SVG generation.
 * This is the single source of truth for formula SVG in the Office app.
 * DO NOT use Temml or core SvgGenerator for SVG output.
 */

const MATHJAX_SCRIPT_SRC = "./mathjax/tex-svg.js";

export class FormulaSvgRenderer {
  constructor() {
    this._readyPromise = null;
  }

  /**
   * Ensure MathJax is loaded and its startup promise resolved.
   * Safe to call multiple times — the load happens only once.
   */
  async ensureReady() {
    if (window.MathJax?.tex2svgPromise) {
      if (window.MathJax.startup?.promise) {
        await window.MathJax.startup.promise;
      }
      return;
    }

    if (!this._readyPromise) {
      this._readyPromise = this._loadMathJax();
    }

    await this._readyPromise;
    if (!window.MathJax?.tex2svgPromise) {
      throw new Error("MathJax SVG renderer is unavailable");
    }
  }

  async _loadMathJax() {
    // Remove any previous loader script tag to avoid duplicate loads
    const existing = document.getElementById("mathjax-tex-svg-loader");
    if (existing) existing.remove();

    window.MathJax = {
      tex: {
        packages: { "[+]": ["ams", "newcommand"] },
      },
      svg: { fontCache: "none" },
      startup: { typeset: false },
    };

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "mathjax-tex-svg-loader";
      script.src = MATHJAX_SCRIPT_SRC;
      script.async = true;
      script.onload = async () => {
        try {
          await window.MathJax.startup.promise;
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = () =>
        reject(new Error("Failed to load MathJax tex-svg.js"));
      document.head.appendChild(script);
    });
  }

  /**
   * Render a LaTeX formula to SVG.
   * @param {string} latex - LaTeX source
   * @param {{ display?: boolean, minWidthPt?: number, minHeightPt?: number, maxWidthPt?: number, maxHeightPt?: number }} [options]
   * @returns {Promise<{ svg: string, widthPt: number, heightPt: number, viewBox: string }>}
   */
  async renderFormulaSvg(latex, options = {}) {
    const display = options.display ?? true;

    if (!latex || !latex.trim()) {
      throw new Error("Empty LaTeX input");
    }

    await this.ensureReady();

    const node = await window.MathJax.tex2svgPromise(latex, { display });
    const svg = node.querySelector("svg");

    if (!svg) {
      throw new Error("MathJax did not produce SVG");
    }

    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const size = this._computeSvgSize(svg, options);

    svg.setAttribute("width", `${size.widthPt}pt`);
    svg.setAttribute("height", `${size.heightPt}pt`);

    return {
      svg: svg.outerHTML,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      viewBox: svg.getAttribute("viewBox") || "",
    };
  }

  /**
   * Compute reasonable pt dimensions for a MathJax-produced SVG element.
   */
  _computeSvgSize(svg, options = {}) {
    const minWidthPt = options.minWidthPt ?? 18;
    const minHeightPt = options.minHeightPt ?? 12;
    const maxWidthPt = options.maxWidthPt ?? 480;
    const maxHeightPt = options.maxHeightPt ?? 240;

    const parseLength = (value) => {
      const s = String(value || "").trim();
      if (!s) return NaN;

      let m = s.match(/^([\d.]+)ex$/);
      if (m) return parseFloat(m[1]) * 4.30554;

      m = s.match(/^([\d.]+)em$/);
      if (m) return parseFloat(m[1]) * 10;

      m = s.match(/^([\d.]+)pt$/);
      if (m) return parseFloat(m[1]);

      m = s.match(/^([\d.]+)px$/);
      if (m) return parseFloat(m[1]) * 0.75;

      m = s.match(/^([\d.]+)/);
      if (m) return parseFloat(m[1]) * 0.75;

      return NaN;
    };

    const widthAttr = svg.getAttribute("width") || "";
    const heightAttr = svg.getAttribute("height") || "";

    let widthPt = parseLength(widthAttr);
    let heightPt = parseLength(heightAttr);
    const viewBoxValues = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const validViewBox =
      viewBoxValues.length === 4 &&
      viewBoxValues.every(Number.isFinite) &&
      viewBoxValues[2] > 0 &&
      viewBoxValues[3] > 0;

    if (
      !Number.isFinite(widthPt) &&
      !Number.isFinite(heightPt) &&
      validViewBox
    ) {
      widthPt = viewBoxValues[2] / 10;
      heightPt = viewBoxValues[3] / 10;
    } else if (
      !Number.isFinite(widthPt) &&
      Number.isFinite(heightPt) &&
      validViewBox
    ) {
      widthPt = (heightPt * viewBoxValues[2]) / viewBoxValues[3];
    } else if (
      Number.isFinite(widthPt) &&
      !Number.isFinite(heightPt) &&
      validViewBox
    ) {
      heightPt = (widthPt * viewBoxValues[3]) / viewBoxValues[2];
    }
    if (!Number.isFinite(widthPt) || widthPt <= 0) widthPt = 120;
    if (!Number.isFinite(heightPt) || heightPt <= 0)
      heightPt = validViewBox
        ? (widthPt * viewBoxValues[3]) / viewBoxValues[2]
        : 36;

    const minimumScale = Math.max(minWidthPt / widthPt, minHeightPt / heightPt);
    const maximumScale = Math.min(maxWidthPt / widthPt, maxHeightPt / heightPt);
    const uniformScale =
      minimumScale <= maximumScale
        ? Math.min(maximumScale, Math.max(minimumScale, 1))
        : maximumScale;
    widthPt *= uniformScale;
    heightPt *= uniformScale;

    return {
      widthPt,
      heightPt,
      viewBox: validViewBox ? viewBoxValues.join(" ") : "",
      aspectRatio: widthPt / heightPt,
    };
  }

  /**
   * Render a LaTeX formula to PNG (rasterized from MathJax SVG).
   * @param {string} latex
   * @param {{ display?: boolean, scale?: number, maxCanvasWidth?: number, maxCanvasHeight?: number }} [options]
   * @returns {Promise<{ pngDataUrl: string, widthPt: number, heightPt: number }>}
   */
  async renderFormulaPng(latex, options = {}) {
    const { svg, widthPt, heightPt } = await this.renderFormulaSvg(
      latex,
      options,
    );
    return this.renderSvgPng(svg, widthPt, heightPt, options);
  }

  async renderSvgPng(svg, widthPt, heightPt, options = {}) {
    const targetDpi = options.targetDpi ?? 300;
    const rawWidth = Math.max(1, (widthPt / 72) * targetDpi);
    const rawHeight = Math.max(1, (heightPt / 72) * targetDpi);
    const maxWidth = options.maxCanvasWidth ?? 8192;
    const maxHeight = options.maxCanvasHeight ?? 8192;
    const maxPixels = options.maxPixels ?? 32 * 1024 * 1024;
    const scale = Math.min(
      1,
      maxWidth / rawWidth,
      maxHeight / rawHeight,
      Math.sqrt(maxPixels / (rawWidth * rawHeight)),
    );
    const widthPx = Math.max(1, Math.round(rawWidth * scale));
    const heightPx = Math.max(1, Math.round(rawHeight * scale));

    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("SVG image decode failed"));
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is unavailable");
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);

    return {
      pngDataUrl: canvas.toDataURL("image/png"),
      widthPt,
      heightPt,
    };
  }
}
