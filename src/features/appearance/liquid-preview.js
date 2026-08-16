// Liquid Glass 2.0 Context Preview HUD node builder.
//
// All user / document / formula text must go through textContent or DOM
// nodes. Never assign preview.innerHTML = userData. The formula preview is
// a rendered node produced by the shared FormulaEditor renderer, appended
// as a node, never as raw concatenated markup.

export const PREVIEW_KINDS = Object.freeze({
  LATEX: "latex",
  MATHML: "mathml",
  OMML: "omml",
  SVG: "svg",
  MD: "md",
  OFFICE_INSERT: "office-insert",
  OFFICE_HOST: "office-host",
  CROSS_REF: "cross-ref",
  EQ_LIST: "eq-list",
});

/**
 * Build a preview HUD node. Safe by construction: every text field is
 * assigned via textContent; the formula visual is an existing DOM node.
 *
 * @param {object} data
 * @param {string} data.title
 * @param {string} [data.subtitle]
 * @param {Node} [data.formulaNode] - rendered formula (Element or Fragment)
 * @param {string} [data.detail] - plain-text detail lines
 * @param {{label:string, tone?:string}} [data.status]
 * @returns {HTMLElement}
 */
export function createLiquidPreviewNode({
  title,
  subtitle,
  formulaNode = null,
  detail = "",
  status = null,
}) {
  const root = document.createElement("div");
  root.className = "liquid-preview-node";

  const header = document.createElement("div");
  header.className = "liquid-preview-header";

  const titleEl = document.createElement("strong");
  titleEl.className = "liquid-preview-title";
  titleEl.textContent = title || "";

  if (subtitle) {
    const subtitleEl = document.createElement("span");
    subtitleEl.className = "liquid-preview-subtitle";
    subtitleEl.textContent = subtitle;
    header.append(titleEl, subtitleEl);
  } else {
    header.append(titleEl);
  }
  root.append(header);

  if (formulaNode) {
    const formulaWrap = document.createElement("div");
    formulaWrap.className = "liquid-preview-formula";
    formulaWrap.append(formulaNode);
    root.append(formulaWrap);
  }

  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "liquid-preview-detail";
    for (const line of String(detail).split("\n")) {
      const lineEl = document.createElement("div");
      lineEl.textContent = line;
      detailEl.append(lineEl);
    }
    root.append(detailEl);
  }

  if (status) {
    const statusEl = document.createElement("div");
    statusEl.className = "liquid-preview-status";
    if (status.tone) statusEl.classList.add(`tone-${status.tone}`);
    statusEl.textContent = status.label || "";
    root.append(statusEl);
  }

  return root;
}

/**
 * Safe text helper for one-line details (keeps callers honest).
 */
export function previewText(value) {
  return document.createTextNode(value ?? "");
}
