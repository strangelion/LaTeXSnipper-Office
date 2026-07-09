/**
 * FormulaSvgRenderer — Unified formula SVG rendering service.
 *
 * Uses MathJax tex-svg for all formula SVG generation.
 * This is the single source of truth for formula SVG in the Office app.
 * DO NOT use Temml or core SvgGenerator for SVG output.
 */

const MATHJAX_SCRIPT_SRC = './mathjax/tex-svg.js';

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
      throw new Error('MathJax SVG renderer is unavailable');
    }
  }

  async _loadMathJax() {
    // Remove any previous loader script tag to avoid duplicate loads
    const existing = document.getElementById('mathjax-tex-svg-loader');
    if (existing) existing.remove();

    window.MathJax = {
      tex: {
        packages: { '[+]': ['ams', 'newcommand'] },
      },
      svg: { fontCache: 'none' },
      startup: { typeset: false },
    };

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'mathjax-tex-svg-loader';
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
      script.onerror = () => reject(new Error('Failed to load MathJax tex-svg.js'));
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
      throw new Error('Empty LaTeX input');
    }

    await this.ensureReady();

    const node = await window.MathJax.tex2svgPromise(latex, { display });
    const svg = node.querySelector('svg');

    if (!svg) {
      throw new Error('MathJax did not produce SVG');
    }

    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const size = this._computeSvgSize(svg, options);

    svg.setAttribute('width', `${size.widthPt}pt`);
    svg.setAttribute('height', `${size.heightPt}pt`);

    return {
      svg: svg.outerHTML,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      viewBox: svg.getAttribute('viewBox') || '',
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

    const parseLength = (value, fallback) => {
      const s = String(value || '').trim();
      if (!s) return fallback;

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

      return fallback;
    };

    const widthAttr = svg.getAttribute('width') || '';
    const heightAttr = svg.getAttribute('height') || '';

    let widthPt = parseLength(widthAttr, 120);
    let heightPt = parseLength(heightAttr, 36);

    // Use viewBox as fallback when width/height are missing
    if ((!widthPt || !heightPt) && svg.getAttribute('viewBox')) {
      const viewBox = svg.getAttribute('viewBox').split(/\s+/);
      widthPt = (parseFloat(viewBox[2]) || 1200) / 10;
      heightPt = (parseFloat(viewBox[3]) || 300) / 10;
    }

    widthPt = Math.min(maxWidthPt, Math.max(minWidthPt, widthPt));
    heightPt = Math.min(maxHeightPt, Math.max(minHeightPt, heightPt));

    return { widthPt, heightPt };
  }

  /**
   * Render a LaTeX formula to PNG (rasterized from MathJax SVG).
   * @param {string} latex
   * @param {{ display?: boolean, scale?: number, maxCanvasWidth?: number, maxCanvasHeight?: number }} [options]
   * @returns {Promise<{ pngDataUrl: string, widthPt: number, heightPt: number }>}
   */
  async renderFormulaPng(latex, options = {}) {
    const { svg, widthPt, heightPt } = await this.renderFormulaSvg(latex, options);

    const scale = Math.min(options.scale ?? window.devicePixelRatio ?? 2, 3);
    const widthPx = Math.min(Math.ceil(widthPt / 0.75 * scale), options.maxCanvasWidth ?? 2400);
    const heightPx = Math.min(Math.ceil(heightPt / 0.75 * scale), options.maxCanvasHeight ?? 1200);

    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, widthPx, heightPx);
      ctx.drawImage(img, 0, 0, widthPx, heightPx);

      return {
        pngDataUrl: canvas.toDataURL('image/png'),
        widthPt,
        heightPt,
      };
    } finally {
      // No blob URL to revoke (using data URL)
    }
  }
}
