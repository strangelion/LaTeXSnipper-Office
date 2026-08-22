import { strict as assert } from "node:assert";
import test from "node:test";
import { instance as createGraphviz } from "@viz-js/viz";
import {
  createProfileDocument,
  serializeVisualDrawing,
} from "../src/features/drawing/visual-editor.js";
import { serializeVisualDocument } from "../src/features/drawing/source-adapters.js";

test("Graphviz visual documents render through the bundled native engine", async () => {
  const graphviz = await createGraphviz();
  for (const template of ["default", "hierarchy", "network", "cycle"]) {
    const { source, graphvizEngine } = serializeVisualDocument(
      "graphviz_dot",
      createProfileDocument("graphviz_dot", template),
    );
    const svg = graphviz.renderString(source, {
      engine: graphvizEngine,
      format: "svg",
    });
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /error/i);
    const viewBox = svg
      .match(/viewBox="([^"]+)"/)?.[1]
      .split(/\s+/)
      .map(Number);
    assert.ok(viewBox?.every(Number.isFinite), template);
    assert.ok(viewBox[2] <= 720, `${template} width ${viewBox[2]}`);
    assert.ok(viewBox[3] <= 520, `${template} height ${viewBox[3]}`);
  }
});

test("Mermaid visual documents parse in every specialized workbench", async () => {
  // Mermaid's browser sanitizer is a factory in Node. The parser only needs
  // these inert hooks; production rendering still uses Mermaid's strict
  // browser configuration in local-renderers.js.
  const { default: domPurify } = await import("dompurify");
  domPurify.addHook ||= () => {};
  domPurify.sanitize ||= (value) => value;
  const { default: mermaid } = await import("mermaid");
  for (const template of ["default", "flow", "sequence", "state", "mindmap"]) {
    const { source } = serializeVisualDocument(
      "mermaid",
      createProfileDocument("mermaid", template),
    );
    const parsed = await mermaid.parse(source);
    assert.ok(parsed?.diagramType, template);
  }
});

test("SVG visual output is already the exact source artifact", () => {
  const objects = createProfileDocument("svg_source", "illustration");
  const visual = serializeVisualDrawing(objects);
  const { source } = serializeVisualDocument("svg_source", objects);
  const withoutContract = source.replace(
    /<!--\s*latexsnipper-visual-v1:[\s\S]*?-->\s*/i,
    "",
  );
  assert.equal(withoutContract, visual);
});
