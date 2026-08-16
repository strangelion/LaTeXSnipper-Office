// Verify the fluid-pointer droplet model on the top nav:
// - droplet follows the cursor continuously (not per-button snaps)
// - it can rest between buttons (free movement)
// - magnetic attraction pulls it near item centres
// - click captures it; leave flows it back to the selected item
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

async function droplet() {
  return page.evaluate(() => {
    const nav = document.querySelector(".liquid-nav")["liquid-nav"]
      ? document.querySelector(".liquid-nav")
      : document.querySelector(".liquid-nav");
    const get = (v) => parseFloat(nav.style.getPropertyValue(v));
    const lens = nav.querySelector("[data-liquid-lens]");
    // Lens vars are dock-local (relative to the nav content box, i.e.
    // nav.left + padding). The lens element itself is position:absolute
    // inside the nav, so its getBoundingClientRect() is authoritative.
    const lr = lens.getBoundingClientRect();
    return {
      visible: nav.dataset.lensVisible,
      opacity: getComputedStyle(lens).opacity,
      centerX: Math.round((lr.left + lr.width / 2) * 10) / 10,
      centerY: Math.round((lr.top + lr.height / 2) * 10) / 10,
      w: Math.round(lr.width * 10) / 10,
      selected: nav.querySelector(".nav-tab.active")?.id,
      varX: Math.round(get("--liquid-lens-x") * 10) / 10,
    };
  });
}

const ocr = await (await page.$("#ocrBtn")).boundingBox();
const history = await (await page.$("#historyBtn")).boundingBox();

// 1. Move to the gap BETWEEN 识别 and 公式库: droplet must follow freely,
//    not snap to either button.
const gapX = (ocr.x + ocr.width + history.x) / 2;
const gapY = ocr.y + ocr.height / 2;
await page.mouse.move(gapX, gapY);
await page.waitForTimeout(600);
const mid = await droplet();
const ocrCenter = ocr.x + ocr.width / 2;
const histCenter = history.x + history.width / 2;
const midOK =
  mid.visible === "true" &&
  parseFloat(mid.opacity) > 0.9 &&
  mid.centerX > ocrCenter &&
  mid.centerX < histCenter;
check(
  "droplet rests between buttons (free follow)",
  midOK,
  JSON.stringify(mid),
);

// 2. Move to 识别 centre: droplet homes in on it (magnetic attraction).
await page.mouse.move(ocr.x + ocr.width / 2, ocr.y + ocr.height / 2);
await page.waitForTimeout(600);
const onOcr = await droplet();
check(
  "droplet homes on hovered item",
  Math.abs(onOcr.centerX - ocrCenter) < 14,
  JSON.stringify(onOcr),
);

// 3. Click 公式库: droplet captures onto it AND the page switches.
await page.mouse.click(
  history.x + history.width / 2,
  history.y + history.height / 2,
);
await page.waitForTimeout(700);
const clicked = await droplet();
check(
  "click captures droplet onto new active",
  clicked.selected === "historyBtn" &&
    Math.abs(clicked.centerX - histCenter) < 10,
  JSON.stringify(clicked),
);

// 4. Move mouse to far right (诊断), then leave the nav entirely:
//    the droplet should flow back to the selected item slowly.
const diag = await (await page.$("#diagnosticsBtn")).boundingBox();
await page.mouse.move(diag.x + diag.width / 2, diag.y + diag.height / 2);
await page.waitForTimeout(500);
const onDiag = await droplet();
await page.mouse.move(1200, 400); // outside nav (nav is top-left area)
await page.waitForTimeout(1200);
const returned = await droplet();
check(
  "droplet flows back to selected on leave",
  returned.selected === "historyBtn" &&
    Math.abs(returned.centerX - histCenter) < 14,
  JSON.stringify({ onDiag, returned }),
);

// 5. aria-selected is on the right tab.
const aria = await page.evaluate(
  () => document.querySelector(".nav-tab[aria-selected='true']")?.id,
);
check("aria-selected on active tab", aria === "historyBtn", aria);

console.log("ERRORS:", errors.join(" | ") || "none");
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - failed.length}/${results.length} passed ===`,
);
await browser.close();
process.exit(failed.length ? 1 : 0);
