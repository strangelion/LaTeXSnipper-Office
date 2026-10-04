const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_FONT_BYTES = 1024 * 1024;
const MAX_TEXT_NODES = 4096;
const MAX_GLYPHS = 16384;
const fonts = new Map();
let fontkitPromise;

export function bundledTexFontName(value) {
  const input = String(value || "").trim();
  const name = /^(?:"[^"]+"|'[^']+')$/.test(input) ? input.slice(1, -1) : input;
  if (!/^[a-z][a-z0-9]{0,31}$/i.test(name)) {
    throw new Error("TEX_FONT_NAME_UNSUPPORTED");
  }
  return name;
}

async function loadBundledTexFont(name) {
  if (fonts.has(name)) return fonts.get(name);
  const pending = (async () => {
    const url = new URL(
      `./vendor/tikzjax/fonts/${name}.woff2`,
      document.baseURI,
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`TEX_FONT_RESOURCE_MISSING: ${name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_FONT_BYTES)
      throw new Error(`TEX_FONT_RESOURCE_LIMIT: ${name}`);
    fontkitPromise ||= import("@pdf-lib/fontkit");
    const { default: fontkit } = await fontkitPromise;
    return fontkit.create(bytes);
  })();
  // Only bundled font names reach this loader; keep parsed-font memory bounded.
  if (fonts.size >= 32) fonts.delete(fonts.keys().next().value);
  fonts.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    if (fonts.get(name) === pending) fonts.delete(name);
    throw error;
  }
}

export function texGlyphPaths({ text, font, x, y, fontSize }) {
  const values = [x, y, fontSize, font?.unitsPerEm];
  if (!values.every(Number.isFinite) || fontSize <= 0 || font.unitsPerEm <= 0)
    throw new Error("TEX_TEXT_GEOMETRY_UNSUPPORTED");
  const characters = [...String(text || "")];
  if (characters.length > MAX_GLYPHS) throw new Error("TEX_GLYPH_LIMIT");
  for (const character of characters) {
    if (!font.hasGlyphForCodePoint(character.codePointAt(0)))
      throw new Error("TEX_GLYPH_MISSING");
  }
  const run = font.layout(text);
  if (run.glyphs.length > MAX_GLYPHS) throw new Error("TEX_GLYPH_LIMIT");
  const scale = fontSize / font.unitsPerEm;
  let advanceX = 0;
  let advanceY = 0;
  return run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    if (
      !position ||
      ![
        position.xOffset,
        position.yOffset,
        position.xAdvance,
        position.yAdvance,
      ].every(Number.isFinite)
    )
      throw new Error("TEX_GLYPH_POSITION_UNSUPPORTED");
    const result = {
      d: glyph.path.toSVG(),
      transform: `translate(${x + (advanceX + position.xOffset) * scale},${y - (advanceY + position.yOffset) * scale}) scale(${scale},${-scale})`,
    };
    advanceX += position.xAdvance;
    advanceY += position.yAdvance;
    return result;
  });
}

function coordinate(element, name, fallback) {
  const value = element.getAttribute(name);
  if (value === null || value.trim() === "") return fallback;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
    throw new Error(`TEX_TEXT_GEOMETRY_UNSUPPORTED: ${name}`);
  return Number(value);
}

/** Make native TeX SVG independent of WebView-only WOFF2 font faces. */
export async function outlineBundledTexSvg(
  source,
  { loadFont = loadBundledTexFont, Parser = globalThis.DOMParser } = {},
) {
  if (!Parser) throw new Error("TEX_SVG_PARSER_UNAVAILABLE");
  const parsed = new Parser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg?.localName !== "svg" || parsed.querySelector("parsererror"))
    throw new Error("TEX_SVG_INVALID");
  const textNodes = [...svg.querySelectorAll("text")];
  if (textNodes.length > MAX_TEXT_NODES) throw new Error("TEX_TEXT_LIMIT");
  let glyphCount = 0;
  for (const text of textNodes) {
    if (
      text.children.length ||
      text.hasAttribute("dx") ||
      text.hasAttribute("dy") ||
      text.hasAttribute("rotate") ||
      ![null, "start"].includes(text.getAttribute("text-anchor")) ||
      ![null, "baseline"].includes(text.getAttribute("alignment-baseline"))
    )
      throw new Error("TEX_TEXT_LAYOUT_UNSUPPORTED");
    const name = bundledTexFontName(text.getAttribute("font-family"));
    const content = text.textContent || "";
    glyphCount += [...content].length;
    if (glyphCount > MAX_GLYPHS) throw new Error("TEX_GLYPH_LIMIT");
    const paths = texGlyphPaths({
      text: content,
      font: await loadFont(name),
      x: coordinate(text, "x", 0),
      y: coordinate(text, "y", 0),
      fontSize: coordinate(text, "font-size", NaN),
    });
    const group = parsed.createElementNS(SVG_NS, "g");
    for (const attribute of text.attributes) {
      if (
        ![
          "x",
          "y",
          "font-family",
          "font-size",
          "alignment-baseline",
          "text-anchor",
        ].includes(attribute.name)
      )
        group.setAttributeNS(
          attribute.namespaceURI,
          attribute.name,
          attribute.value,
        );
    }
    group.setAttribute("data-tex-font", name);
    for (const outline of paths) {
      if (!outline.d) continue;
      const path = parsed.createElementNS(SVG_NS, "path");
      path.setAttribute("d", outline.d);
      path.setAttribute("transform", outline.transform);
      group.appendChild(path);
    }
    text.replaceWith(group);
  }
  svg.setAttribute("data-tex-glyph-outlines", String(glyphCount));
  return svg.outerHTML;
}
