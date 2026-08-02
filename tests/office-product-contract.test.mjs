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

const nav = html.match(/<div class="nav-tabs"[\s\S]*?<\/div>/)?.[0] || "";
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
assert.match(html, /Native OMML \/ OLE \/ SVG \/ PNG/);
assert.match(html, /id="diagnosticsSection"/);
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
for (const control of [
  "formulaModeTab",
  "drawingModeTab",
  "drawingCompileBtn",
  "drawingInsertBtn",
  "officeWorkspaceRead",
  "officeWorkspaceReplace",
  "officeWorkspaceBatch",
  "officeWorkspaceInventory",
]) {
  assert.match(html, new RegExp(`id="${control}"`));
}
assert.doesNotMatch(main, /\$\{command \|\| "命令"\}/);
assert.match(css, /grid-template-columns:\s*minmax\(168px/);
assert.match(css, /@media \(max-width: 1100px\)/);
assert.match(css, /@media \(forced-colors: active\)/);
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
