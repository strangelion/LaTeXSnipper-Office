import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const html = readFileSync(
  new URL("../src/index.html", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/styles/main.css", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const localRenderers = readFileSync(
  new URL("../src/features/drawing/local-renderers.js", import.meta.url),
  "utf8",
);
const viteConfig = readFileSync(
  new URL("../vite.config.js", import.meta.url),
  "utf8",
);

const nav =
  html.match(
    /<div[^>]*class="nav-tabs[^"]*"[\s\S]*?(?=\n\s*<button\s+class="theme-toggle)/,
  )?.[0] || "";
const workspaces = [...nav.matchAll(/id="(\w+)Btn"/g)].map((match) => match[1]);
assert.deepEqual(workspaces, [
  "editor",
  "ocr",
  "history",
  "office",
  "diagnostics",
]);
assert.match(html, /id="settingsBtn"/);
assert.doesNotMatch(nav, /settingsBtn/);
const settingsButton =
  html.match(/<button[\s\S]*?id="settingsBtn"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(settingsButton, /<svg[\s\S]*?class="settings-icon"/);
assert.doesNotMatch(settingsButton, /⚙/);
for (const label of ["切换明暗主题", "关闭公式库", "打开公式库"]) {
  assert.match(html, new RegExp(`aria-label="${label}"`));
}
assert.match(html, /aria-label="编辑命令"/);
for (const format of ["smart", "latex", "omml", "svg", "mathml", "md"]) {
  assert.match(html, new RegExp(`data-editor-copy-format="${format}"`));
}
assert.match(html, /id="diagnosticsSection"/);
const recognitionActions =
  html.match(/<div class="recognition-actions">[\s\S]*?<\/div>/)?.[0] || "";
assert.match(recognitionActions, /id="browserImportsButton"/);
assert.match(recognitionActions, /id="browserImportsBadge"/);
assert.doesNotMatch(
  css,
  /\.browser-imports-button\s*{[\s\S]*?position:\s*fixed/,
);
for (const control of [
  "symbolFormulaSource",
  "symbolCatalogSearch",
  "symbolFreehandBtn",
  "symbolLayerInspector",
  "symbolLayerScaleX",
  "symbolLayerScaleY",
  "symbolCategoryPrev",
  "symbolCategoryNext",
  "officeInsertRouteSelector",
  "refreshDiagnosticsBtn",
  "diagnosticsOverallState",
  "openOfficeWorkspaceBtn",
]) {
  assert.match(html, new RegExp(`id="${control}"`));
}
assert.doesNotMatch(html, /功能标签/);
assert.match(localRenderers, /JSON\.stringify\(\{ pgfplots: "" \}\)/);
assert.match(viteConfig, /runtime\/file\/\$\{A\}/);
assert.ok(
  html.indexOf("platform-capability-details") <
    html.indexOf('id="platformList"'),
  "compatibility details should be visible before the platform card grid",
);
for (const resource of [
  "symbols",
  "structures",
  "templates",
  "history",
  "document",
]) {
  assert.match(html, new RegExp(`data-formula-resource="${resource}"`));
}
for (const label of [
  "宿主感知",
  "证据优先",
  "核心就绪状态",
  "执行后端验证",
  "Office 桥接",
]) {
  assert.match(html, new RegExp(label));
}
for (const staleEnglishLabel of [
  "HOST AWARE",
  "EVIDENCE FIRST",
  "Core readiness",
  "Provider validation",
  "Editable OLE",
]) {
  assert.doesNotMatch(html, new RegExp(staleEnglishLabel));
}
assert.match(
  main,
  /MathfieldElement\.strings\s*=\s*{\s*"zh-CN": _MATHLIVE_I18N/,
);
assert.match(main, /MathfieldElement\.locale\s*=\s*"zh-CN"/);
for (const command of ["new", "open", "export", "undo", "redo", "palette"]) {
  assert.match(main, new RegExp(`command === "${command}"`));
}
assert.match(main, /className = "command-palette-layer"/);
assert.match(main, /event\.target === layer/);
assert.match(main, /event\.key === "Escape"/);
for (const commandLabel of [
  '["screenshot", "截图", "采集"]',
  '["insert", "插入", "采集"]',
  '["undo", "撤销", "历史"]',
  '["redo", "重做", "历史"]',
]) {
  assert.match(main, new RegExp(commandLabel.replace(/[\[\]]/g, "\\$&")));
}
for (const control of [
  "formulaModeTab",
  "drawingModeTab",
  "drawingCompileBtn",
  "drawingInsertBtn",
  "editorInspectorInsert",
  "editorInspectorRead",
  "drawingPlotCurve",
  "drawingPlotExpression",
  "drawingGraphvizEngine",
  "drawingGraphNodeAdd",
  "drawingTikzLatexAdd",
  "drawingMindRootCreate",
  "drawingMindChildAdd",
  "drawingPreviewSource",
  "drawingInspectorText",
  "officeWorkspaceRead",
  "officeWorkspaceReplace",
  "officeWorkspaceBatch",
  "officeWorkspaceInventory",
]) {
  assert.match(html, new RegExp(`id="${control}"`));
}
for (const profile of [
  "svg_source",
  "tikz",
  "pgf_plots",
  "graphviz_dot",
  "mermaid",
]) {
  assert.match(html, new RegExp(`data-drawing-workbench="${profile}"`));
}
assert.match(main, /data-editor-copy-format/);
assert.match(main, /syncEditorInspector\(\)/);
assert.doesNotMatch(main, /\$\{command \|\| "命令"\}/);
assert.match(css, /grid-template-columns:\s*minmax\(168px/);
assert.match(css, /\.editor-inspector\s*{[\s\S]*?top:\s*0/);
assert.match(css, /@media \(max-width: 1100px\)/);
assert.match(css, /@media \(forced-colors: active\)/);
assert.match(
  css,
  /\.browser-imports-dialog\s*{[\s\S]*?background:\s*var\(--card-bg\)/,
);
assert.match(main, /async refreshDiagnostics\(\)/);
const mobileStart = css.indexOf("@media (max-width: 768px)");
const mobileEnd = css.indexOf(
  "/* ═══════════════════════════════════════════",
  mobileStart,
);
const mobileCss = css.slice(mobileStart, mobileEnd);
assert.match(mobileCss, /\.nav-tabs\s*{[\s\S]*?display:\s*flex/);
assert.doesNotMatch(mobileCss, /\.nav-tabs\s*{[\s\S]*?display:\s*none/);
assert.doesNotMatch(css, /min-width:\s*(?:1[2-9]\d\d|[2-9]\d{3,})px/);

console.log("Office five-workspace UI contract passed OK");
