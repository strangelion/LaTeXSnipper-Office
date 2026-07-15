import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert";

const root = resolve(import.meta.dirname, "..");
const htmlPath = resolve(root, "src", "index.html");
const html = readFileSync(htmlPath, "utf8");

describe("Desktop entry point integrity", () => {
  it("should contain #app container", () => {
    assert.match(html, /id="app"/, "Missing #app container");
  });

  it("should contain #editorSection", () => {
    assert.match(html, /id="editorSection"/, "Missing #editorSection");
  });

  it("should contain #mathfieldHost", () => {
    assert.match(html, /id="mathfieldHost"/, "Missing #mathfieldHost");
  });

  it("should contain #latexSource", () => {
    assert.match(html, /id="latexSource"/, "Missing #latexSource");
  });

  it("should contain #settingsSection", () => {
    assert.match(html, /id="settingsSection"/, "Missing #settingsSection");
  });

  it("should contain #ecosystemHostSelector", () => {
    assert.match(
      html,
      /id="ecosystemHostSelector"/,
      "Missing #ecosystemHostSelector",
    );
  });

  it("should NOT be sidebar prototype", () => {
    assert.doesNotMatch(
      html,
      /<aside class="sidebar" id="sidebar">/,
      "Desktop entry regressed to Office sidebar prototype",
    );
  });
});
