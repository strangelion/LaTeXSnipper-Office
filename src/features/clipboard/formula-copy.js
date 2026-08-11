const FORMAT_PLANS = Object.freeze({
  latex: {
    profile: "latexOnly",
    requestedFormats: ["text/plain"],
    label: "LaTeX",
  },
  mathml: {
    profile: "smart",
    requestedFormats: ["application/mathml+xml"],
    label: "MathML",
  },
  omml: {
    profile: "office",
    requestedFormats: ["application/vnd.latexsnipper.omml+xml"],
    label: "OMML",
  },
  svg: {
    profile: "image",
    requestedFormats: ["image/svg+xml"],
    label: "SVG",
    renderSvg: true,
  },
  md: {
    profile: "markdown",
    requestedFormats: ["text/markdown"],
    label: "Markdown",
    preferMarkdown: true,
  },
  markdown: {
    profile: "markdown",
    requestedFormats: ["text/markdown"],
    label: "Markdown",
    preferMarkdown: true,
  },
  markdown_inline: {
    profile: "markdown",
    requestedFormats: ["text/markdown"],
    label: "Markdown",
    preferMarkdown: true,
  },
});

export function formulaCopyPlan(format = "smart") {
  if (format === "smart") {
    return {
      profile: "smart",
      requestedFormats: null,
      label: "智能公式包",
      renderSvg: true,
      renderPng: true,
    };
  }
  return FORMAT_PLANS[format] || FORMAT_PLANS.latex;
}

export function shouldPreserveNativeCopy(
  event,
  selection = globalThis.getSelection?.(),
) {
  if (
    event.defaultPrevented ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey ||
    String(event.key).toLowerCase() !== "c"
  ) {
    return true;
  }

  const target = event.target;
  if (
    globalThis.Element &&
    target instanceof globalThis.Element &&
    target.closest(
      'input, textarea, math-field, [contenteditable="true"], [contenteditable="plaintext-only"]',
    )
  ) {
    return true;
  }

  return Boolean(
    selection && !selection.isCollapsed && String(selection).length > 0,
  );
}
