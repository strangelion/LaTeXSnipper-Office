// Verify velocity-driven stretch: a fast horizontal sweep should elongate
// the droplet scaleX while a slow move keeps it ~1.
const PW_CORE =
  "C:/Users/WangWenXuan/AppData/Local/Temp/pwtest/node_modules/playwright-core";
const { chromium } = await import(`file:///${PW_CORE}/index.mjs`);
const browser = await chromium.launch({
  executablePath:
    "C:/Users/WangWenXuan/AppData/Local/ms-playwright/chromium-1237/chrome-win64/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:4319/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

async function scaleX() {
  return page.evaluate(() => {
    const nav = document.querySelector(".liquid-nav");
    return parseFloat(nav.style.getPropertyValue("--liquid-scale-x"));
  });
}

// Slow move: scale stays ~1
const ocr = await (await page.$("#ocrBtn")).boundingBox();
await page.mouse.move(ocr.x + ocr.width / 2, ocr.y + ocr.height / 2);
await page.waitForTimeout(400);
const slow = await scaleX();

// Fast sweep right across the whole nav in ~1 frame
const nav = await page.$(".liquid-nav");
const nr = await nav.boundingBox();
await page.mouse.move(nr.x + 10, nr.y + nr.height / 2);
await page.waitForTimeout(50);
await page.mouse.move(nr.x + nr.width - 10, nr.y + nr.height / 2);
await page.waitForTimeout(50);
const fast = await scaleX();

console.log(`slow scaleX: ${slow.toFixed(3)}`);
console.log(`fast scaleX: ${fast.toFixed(3)}`);
console.log(`stretch detected: ${fast > slow + 0.005 ? "YES" : "NO"}`);
console.log(`within cap (<=1.09): ${fast <= 1.09 ? "YES" : "NO"}`);
await browser.close();
process.exit(fast > slow + 0.005 && fast <= 1.09 ? 0 : 1);
