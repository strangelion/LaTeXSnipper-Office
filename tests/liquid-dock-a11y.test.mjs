/**
 * Liquid Dock accessibility & safety tests.
 *
 * Static assertions over src/index.html and the preview builder source:
 * - Lens and preview layers are aria-hidden
 * - focusable items remain focusable and get :focus-visible styles
 * - disabled items are excluded
 * - preview builds DOM nodes via textContent, never raw innerHTML
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src", "index.html"), "utf8");
const previewSrc = readFileSync(
  resolve(root, "src", "features", "appearance", "liquid-preview.js"),
  "utf8",
);
const dockSrc = readFileSync(
  resolve(root, "src", "features", "appearance", "liquid-dock.js"),
  "utf8",
);
const css = readFileSync(
  resolve(root, "src", "styles", "liquid-glass.css"),
  "utf8",
);

describe("Dock DOM structure", () => {
  it("has a single liquid dock with lens + preview layers", () => {
    assert.match(html, /data-liquid-dock/, "dock attribute present");
    assert.match(html, /data-liquid-lens/, "lens layer present");
    assert.match(html, /data-liquid-preview/, "preview layer present");
    assert.match(html, /liquid-dock-sheen/, "sheen layer present");
    assert.match(html, /liquid-lens-surface/, "lens surface present");
    assert.match(html, /liquid-lens-highlight/, "lens highlight present");
    assert.match(html, /liquid-lens-chromatic/, "lens chromatic present");
  });

  it("keeps the lens and preview layers out of the a11y tree", () => {
    const lens = html.match(
      /<div\s+class="liquid-lens-positioner"\s+data-liquid-lens\s+aria-hidden="true"/,
    );
    assert.ok(lens, "lens positioner aria-hidden");
    assert.match(
      html,
      /class="liquid-dock-preview glass-popover"[\s\S]*?aria-hidden="true"/,
      "preview aria-hidden",
    );
    assert.match(html, /data-visible="false"/, "preview starts hidden");
  });

  it("flags every dock action control as a liquid item", () => {
    const ids = [
      "copyLatex",
      "copyMathml",
      "copyOmmL",
      "copySvg",
      "insertToWord",
      "insertCrossRefBtn",
      "insertEquationListBtn",
    ];
    for (const id of ids) {
      const block = html.match(new RegExp(`id="${id}"[\\s\\S]*?(?=>)`));
      assert.ok(block, `#${id} exists`);
      assert.match(block[0], /data-liquid-item/, `#${id} is a liquid item`);
    }
  });

  it("marks disabled-by-default Office controls as hidden but present", () => {
    // These are toggled by the app; the a11y tree must not expose the lens.
    assert.match(html, /data-liquid-preview-kind="office-insert"/);
    assert.match(html, /data-liquid-preview-kind="cross-ref"/);
    assert.match(html, /data-liquid-preview-kind="eq-list"/);
  });

  it("provides a live material preview in settings", () => {
    assert.match(html, /liquid-material-demo/, "settings preview container");
    assert.match(html, /data-liquid-demo-dock/, "settings demo dock");
    assert.match(html, /liquid-demo-wall/, "colored demo wall");
  });

  it("applies the liquid dock to the top navigation", () => {
    assert.match(html, /class="nav-tabs liquid-nav"/, "nav liquid dock");
    assert.match(html, /data-liquid-dock/, "nav dock attribute");
    const navTabs =
      html.match(
        /<div[^>]*class="nav-tabs[^"]*"[\s\S]*?(?=\n\s*<button\s+class="theme-toggle)/,
      )?.[0] || "";
    assert.match(navTabs, /data-liquid-lens/, "nav lens layer");
    assert.match(navTabs, /liquid-lens-bridge/, "nav bridge layer");
    assert.match(navTabs, /liquid-dock-sheen/, "nav sheen layer");
    const tabs = [
      ...navTabs.matchAll(/class="nav-tab[^"]*"[^>]*data-liquid-item/g),
    ];
    assert.equal(tabs.length, 5, "all five nav tabs are liquid items");
  });
});

describe("Focus & disabled handling", () => {
  it("keeps :focus-visible outline for liquid items", () => {
    assert.match(
      css,
      /\[data-liquid-item\]:focus-visible\s*(,|\{)/,
      "focus-visible rule exists",
    );
    assert.match(css, /outline: 2px solid var\(--accent\)/);
  });

  it("dims disabled liquid items", () => {
    assert.match(
      css,
      /\.liquid-dock \[data-liquid-item\]\[disabled\]/,
      "disabled rule",
    );
    assert.match(css, /opacity: 0\.6/);
  });

  it("controller excludes aria-disabled and disabled items", () => {
    assert.match(dockSrc, /isDisabledItem\(item\)/, "disabled predicate");
    assert.match(dockSrc, /aria-disabled/);
    assert.match(dockSrc, /item\.disabled/);
    // Lens must not enter disabled items.
    assert.match(
      dockSrc,
      /if \(!item \|\| this\.isDisabledItem\(item\)\) return null/,
      "disabled items resolve to null",
    );
  });
});

describe("Safe preview DOM", () => {
  it("builds nodes with textContent, never raw innerHTML assignment", () => {
    // All user-facing text fields use textContent.
    assert.match(previewSrc, /textContent = title \|\| ""/);
    assert.match(previewSrc, /textContent = subtitle/);
    assert.match(previewSrc, /lineEl\.textContent = line/);
    assert.match(previewSrc, /statusEl\.textContent = status\.label \|\| ""/);
    // The builder must not assign innerHTML to user data (exclude comments).
    const codeOnly = previewSrc
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(
      codeOnly,
      /\.innerHTML\s*=\s*\w+/,
      "no raw innerHTML assignment in preview builder",
    );
    // Formula visuals are appended as nodes, never concatenated markup.
    assert.match(previewSrc, /formulaWrap\.append\(formulaNode\)/);
  });

  it("rejects the template-literal innerHTML anti-pattern", () => {
    assert.doesNotMatch(
      previewSrc,
      /innerHTML\s*=\s*`/,
      "no template-literal innerHTML",
    );
    assert.doesNotMatch(
      previewSrc,
      /insertAdjacentHTML/,
      "no insertAdjacentHTML",
    );
  });

  it("preview container starts hidden and reveals via data-visible", () => {
    assert.match(html, /data-liquid-preview\s+data-visible="false"/);
    assert.match(css, /\.liquid-dock-preview\[data-visible="true"\]/);
  });

  it("controller wires preview visibility to aria-hidden", () => {
    assert.match(dockSrc, /setAttribute\("aria-hidden", "false"\)/);
    assert.match(dockSrc, /setAttribute\("aria-hidden", "true"\)/);
    assert.match(dockSrc, /content\.replaceChildren\(node\)/);
  });
});

describe("Reduced motion contract", () => {
  it("static quality keeps glass but stops motion", () => {
    assert.match(css, /html\[data-liquid-quality="static"\] \.liquid-dock/);
    assert.match(css, /--liquid-motion-position: 0ms/);
    assert.match(
      css,
      /html\[data-liquid-quality="static"\] \.liquid-dock-sheen\s*\{/,
    );
    assert.match(css, /opacity: 0/);
  });

  it("off quality removes backdrop-filter and lens layers", () => {
    assert.match(css, /html\[data-liquid-glass="off"\] \.liquid-dock\s*\{/);
    assert.match(css, /backdrop-filter: none/);
    assert.match(
      css,
      /html\[data-liquid-glass="off"\] \.liquid-lens-positioner/,
    );
    assert.match(css, /display: none/);
  });
});
