// Verify the static-quality bug: with reduced-motion/static, clicking a nav
// item must IMMEDIATELY move the droplet (no RAF needed).
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

// Force static quality BEFORE app init via localStorage + reduced motion.
await page.addInitScript(() => {
  try {
    localStorage.setItem("latexsnipper.liquidGlassMode", "on");
  } catch {}
});
await page.goto("http://127.0.0.1:4319/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Force static by dispatching a synthetic glass-change with quality static
// is hard; instead verify the snap path works when quality is static by
// reading the droplet position after clicking with reduced-motion emulated.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(500);
// Reload to re-resolve quality under reduced motion
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const state = await page.evaluate(() => {
  const html = document.documentElement;
  const nav = document.querySelector(".liquid-nav");
  const lens = nav.querySelector("[data-liquid-lens]");
  return {
    quality: html.dataset.liquidQuality,
    liquidGlass: html.dataset.liquidGlass,
    lensVisible: nav.dataset.lensVisible,
    lensOpacity: getComputedStyle(lens).opacity,
    varX: nav.style.getPropertyValue("--liquid-lens-x"),
  };
});
console.log("STATE (reduced-motion):", JSON.stringify(state));

// Click 识别 -> droplet must snap even in static quality.
const ocr = await (await page.$("#ocrBtn")).boundingBox();
await page.mouse.click(ocr.x + ocr.width / 2, ocr.y + ocr.height / 2);
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const nav = document.querySelector(".liquid-nav");
  const lens = nav.querySelector("[data-liquid-lens]");
  const lr = lens.getBoundingClientRect();
  const ocr = document.getElementById("ocrBtn");
  const or = ocr.getBoundingClientRect();
  return {
    active: nav.querySelector(".nav-tab.active")?.id,
    dropletCenter: Math.round((lr.left + lr.width / 2) * 10) / 10,
    ocrCenter: Math.round((or.left + or.width / 2) * 10) / 10,
    aligned: Math.abs(lr.left + lr.width / 2 - (or.left + or.width / 2)) < 4,
  };
});
console.log("AFTER CLICK:", JSON.stringify(after));
const ok =
  state.quality === "static" && after.active === "ocrBtn" && after.aligned;
console.log(ok ? "PASS: static quality snaps droplet to selection" : "FAIL");
console.log("ERRORS:", errors.join(" | ") || "none");
await browser.close();
process.exit(ok ? 0 : 1);
