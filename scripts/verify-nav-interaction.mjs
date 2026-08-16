// Verify the selection/hover interaction split:
// - Top nav (selection): Lens locked on active; hover drives glow only.
// - Action dock (hover): Lens follows the pointer.
const PW_CORE =
  "C:/Users/WangWenXuan/AppData/Local/Temp/pwtest/node_modules/playwright-core";
const { chromium } = await import(`file:///${PW_CORE}/index.mjs`);
const browser = await chromium.launch({
  executablePath:
    "C:/Users/WangWenXuan/AppData/Local/ms-playwright/chromium-1237/chrome-win64/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
await page.goto("http://127.0.0.1:4319/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

async function navLens() {
  return page.evaluate(() => {
    const nav = document.querySelector(".liquid-nav");
    const get = (v) => parseFloat(nav.style.getPropertyValue(v));
    const active = nav.querySelector(".nav-tab.active");
    const ar = active.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const lensLeft = nr.left + get("--liquid-lens-x");
    const lensC = lensLeft + get("--liquid-lens-w") / 2;
    const activeC = ar.left + ar.width / 2;
    return {
      active: active.id,
      lensCenter: Math.round(lensC * 10) / 10,
      activeCenter: Math.round(activeC * 10) / 10,
      off: Math.round(Math.abs(lensC - activeC) * 10) / 10,
      glow: nav.dataset.hoverGlow,
      lensOpacity: getComputedStyle(
        nav.querySelector("[data-liquid-lens]"),
      ).opacity,
    };
  });
}

// 1. Selection mode: hover 识别 must NOT move the Lens (stays on 编辑)
const init = await navLens();
check("initial lens on active", init.off < 2, JSON.stringify(init));

const ocr = await (await page.$("#ocrBtn")).boundingBox();
await page.mouse.move(ocr.x + ocr.width / 2, ocr.y + ocr.height / 2);
await page.waitForTimeout(500);
const hover = await navLens();
check(
  "selection: hover does not move lens (still active)",
  hover.active === "editorBtn" && hover.off < 2,
  JSON.stringify(hover),
);
check("selection: hover glow active", hover.glow === "true");

// 2. Click 公式库 -> Lens glides to it and stays
const hist = await (await page.$("#historyBtn")).boundingBox();
await page.mouse.click(hist.x + hist.width / 2, hist.y + hist.height / 2);
await page.waitForTimeout(700);
const clicked = await navLens();
check(
  "selection: click moves lens to new active",
  clicked.active === "historyBtn" && clicked.off < 2,
  JSON.stringify(clicked),
);

// 3. Mouse leaves nav -> lens stays on active
await page.mouse.move(20, 500);
await page.waitForTimeout(600);
const away = await navLens();
check("selection: lens stays after leave", away.off < 2, JSON.stringify(away));
check("selection: glow cleared on leave", away.glow !== "true");

// 4. z-index: nav-tab text sits above the lens
const zCheck = await page.evaluate(() => {
  const nav = document.querySelector(".liquid-nav");
  const tab = nav.querySelector(".nav-tab");
  const lens = nav.querySelector("[data-liquid-lens]");
  const lensPos = getComputedStyle(lens).zIndex;
  const tabPos = getComputedStyle(tab).zIndex;
  return { lens: lensPos, tab: tabPos };
});
check(
  "z-index: text above lens",
  Number(zCheck.tab) > Number(zCheck.lens),
  JSON.stringify(zCheck),
);

// 5. Bottom dock (hover mode): lens follows the pointer.
//    Switch back to the editor workspace first (copyLatex lives there).
const editor = await page.$("#editorBtn");
const eb = await editor.boundingBox();
await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2);
await page.waitForTimeout(500);
const copyLatex = await page.$("#copyLatex");
await copyLatex.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const cb = await copyLatex.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.waitForTimeout(500);
const dock = await page.evaluate(() => {
  const root = document.getElementById("officeActionDock");
  const get = (v) => parseFloat(root.style.getPropertyValue(v));
  const btn = document.getElementById("copyLatex");
  const br = btn.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const lensC = rr.left + get("--liquid-lens-x") + get("--liquid-lens-w") / 2;
  const btnC = br.left + br.width / 2;
  const lensOpacity = getComputedStyle(
    root.querySelector("[data-liquid-lens]"),
  ).opacity;
  return {
    visible: root.dataset.lensVisible,
    opacity: lensOpacity,
    off: Math.round(Math.abs(lensC - btnC) * 10) / 10,
  };
});
check(
  "dock (hover mode): lens follows pointer",
  dock.visible === "true" && parseFloat(dock.opacity) > 0.9 && dock.off < 2,
  JSON.stringify(dock),
);

console.log("ERRORS:", errors.join(" | ") || "none");
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
await browser.close();
process.exit(failed.length ? 1 : 0);
