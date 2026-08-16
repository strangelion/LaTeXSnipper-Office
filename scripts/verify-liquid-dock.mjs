// Headless verification of the Liquid Dock against a served build.
//
// Usage:
//   npx vite build && npx vite preview --port 4319 &
//   PW_CORE=/path/to/playwright-core/node_modules \
//   PW_CHROMIUM=/path/to/chrome.exe \
//   node scripts/verify-liquid-dock.mjs
//
// PW_CORE must point at a directory containing a playwright-core install
// (e.g. from `npm install --no-save playwright-core`). PW_CHROMIUM must
// point at a Chromium/Chrome executable. Both have no defaults: run the
// script to see resolution hints.

const PW_CORE = process.env.PW_CORE;
const PW_CHROMIUM = process.env.PW_CHROMIUM;
if (!PW_CORE || !PW_CHROMIUM) {
  console.error(
    "Missing env. Set PW_CORE (playwright-core install dir) and PW_CHROMIUM (browser exe).",
  );
  console.error(
    "Hint: npm i --no-save playwright-core && npx playwright install chromium",
  );
  process.exit(2);
}
const { chromium } = await import(
  `file:///${PW_CORE.replace(/\\/g, "/")}/index.mjs`
);

const URL = process.env.LIQUID_DOCK_URL ?? "http://127.0.0.1:4319/";
const SHOT_DIR = process.env.LIQUID_DOCK_SHOTS ?? "";

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
}

const browser = await chromium.launch({ executablePath: PW_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);

// 1. Dock DOM presence
const dock = await page.$("#officeActionDock");
check("dock element exists", Boolean(dock));

const lens = await page.$("#officeActionDock [data-liquid-lens]");
const surface = await page.$("#officeActionDock .liquid-lens-surface");
const sheen = await page.$("#officeActionDock .liquid-dock-sheen");
const preview = await page.$("#officeActionDock [data-liquid-preview]");
check(
  "lens/surface/sheen/preview layers exist",
  Boolean(lens && surface && sheen && preview),
);

// 2. CSS custom properties applied by controller
const cssVars = await page.evaluate(() => {
  const dockEl = document.getElementById("officeActionDock");
  const s = dockEl.style;
  return {
    x: s.getPropertyValue("--liquid-lens-x"),
    y: s.getPropertyValue("--liquid-lens-y"),
    w: s.getPropertyValue("--liquid-lens-w"),
    h: s.getPropertyValue("--liquid-lens-h"),
    visible: dockEl.dataset.lensVisible,
    quality: document.documentElement.dataset.liquidQuality,
    liquidGlass: document.documentElement.dataset.liquidGlass,
  };
});
check(
  "quality attr on <html>",
  cssVars.quality === "full" ||
    cssVars.quality === "reduced" ||
    cssVars.quality === "static",
  JSON.stringify(cssVars),
);

// 3. Hover over 复制 LaTeX button -> lens should become visible
const copyLatex = await page.$("#copyLatex");
await copyLatex.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await copyLatex.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(450);
const hoverState = await page.evaluate(() => {
  const dockEl = document.getElementById("officeActionDock");
  return {
    visible: dockEl.dataset.lensVisible,
    x: dockEl.style.getPropertyValue("--liquid-lens-x"),
    y: dockEl.style.getPropertyValue("--liquid-lens-y"),
    w: dockEl.style.getPropertyValue("--liquid-lens-w"),
    px: dockEl.style.getPropertyValue("--liquid-pointer-x"),
    scaleX: dockEl.style.getPropertyValue("--liquid-scale-x"),
  };
});
check(
  "lens visible on hover",
  hoverState.visible === "true",
  JSON.stringify(hoverState),
);
check(
  "lens geometry non-zero on hover",
  parseFloat(hoverState.w) > 0 && parseFloat(hoverState.x) >= 0,
  JSON.stringify(hoverState),
);
check("pointer field tracked", hoverState.px !== "50%", `px=${hoverState.px}`);

await page.screenshot({
  path: `${SHOT_DIR ? SHOT_DIR + "/" : ""}liquid-dock-hover.png`,
});

// 4. Preview HUD appears after 180ms delay
await page.waitForTimeout(350);
const previewState = await page.evaluate(() => {
  const p = document.querySelector("#officeActionDock [data-liquid-preview]");
  return {
    visible: p?.dataset.visible,
    hidden: p?.getAttribute("aria-hidden"),
  };
});
check(
  "preview visible after delay",
  previewState.visible === "true",
  JSON.stringify(previewState),
);
check("preview aria-hidden false", previewState.hidden === "false");
await page.screenshot({
  path: `${SHOT_DIR ? SHOT_DIR + "/" : ""}liquid-dock-preview.png`,
});

// 5. Move to another button -> lens slides
const copyMathml = await page.$("#copyMathml");
await copyMathml.scrollIntoViewIfNeeded();
const box2 = await copyMathml.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
await page.waitForTimeout(450);
const moveState = await page.evaluate(() => {
  const dockEl = document.getElementById("officeActionDock");
  return {
    x: dockEl.style.getPropertyValue("--liquid-lens-x"),
    visible: dockEl.dataset.lensVisible,
  };
});
check(
  "lens slides to second item",
  parseFloat(moveState.x) !== parseFloat(hoverState.x),
  `${hoverState.x} -> ${moveState.x}`,
);
await page.screenshot({
  path: `${SHOT_DIR ? SHOT_DIR + "/" : ""}liquid-dock-slide.png`,
});

// 6. Pointer leave -> lens falls back (active item is null, so hides) and pointer returns to 50/24
await page.mouse.move(10, 400);
await page.waitForTimeout(1200);
const leaveState = await page.evaluate(() => {
  const dockEl = document.getElementById("officeActionDock");
  return {
    visible: dockEl.dataset.lensVisible,
    px: dockEl.style.getPropertyValue("--liquid-pointer-x"),
    py: dockEl.style.getPropertyValue("--liquid-pointer-y"),
  };
});
check(
  "lens hides after leave (no active)",
  leaveState.visible === "false",
  JSON.stringify(leaveState),
);
// leave speed is 0.06; allow a generous window around the 50/24 target
check(
  "pointer field returns toward 50/24",
  Math.abs(parseFloat(leaveState.px) - 50) < 8 &&
    Math.abs(parseFloat(leaveState.py) - 24) < 8,
  `px=${leaveState.px} py=${leaveState.py}`,
);

// 7. Focus (keyboard) moves the lens too — focus the copy button directly
const focusVisible = await page.evaluate(() => {
  const btn = document.getElementById("copyLatex");
  btn.focus();
  return new Promise((res) =>
    setTimeout(() => {
      const dockEl = document.getElementById("officeActionDock");
      res({ visible: dockEl.dataset.lensVisible });
    }, 300),
  );
});
check(
  "lens follows keyboard focus",
  focusVisible.visible === "true",
  JSON.stringify(focusVisible),
);

// 8. Click on a button -> pulse class on surface
await page.evaluate(() => {
  const btn = document.getElementById("copyLatex");
  btn.click();
});
await page.waitForTimeout(80);
const pulsing = await page.evaluate(() =>
  document
    .querySelector("#officeActionDock .liquid-lens-surface")
    ?.classList.contains("is-pulsing"),
);
check("pulse fires on click", pulsing === true, `pulsing=${pulsing}`);

// 9. Disabled check: insertToWord is display:none by default (no Office)
const insertHidden = await page.evaluate(() => {
  const el = document.getElementById("insertToWord");
  return getComputedStyle(el).display === "none";
});
check("office-insert hidden without Office", insertHidden);

// 10. No console errors from our modules (ignore Tauri API missing)
const relevantErrors = consoleErrors.filter(
  (e) => !e.includes("__TAURI_INTERNALS__") && !e.includes("tauri"),
);
check(
  "no module console errors",
  relevantErrors.length === 0,
  relevantErrors.slice(0, 3).join(" | "),
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - failed.length}/${results.length} passed ===`,
);
process.exit(failed.length ? 1 : 0);
