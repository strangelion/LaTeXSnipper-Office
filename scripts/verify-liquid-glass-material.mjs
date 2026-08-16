// Verify the lens material reads as optical glass, not a white circle:
// the body must be nearly transparent and the highlight must be a small
// specular spot, not a big bright fill.
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

// Hover to make lens visible
await page.evaluate(() =>
  document.getElementById("copyLatex").scrollIntoViewIfNeeded(),
);
await page.waitForTimeout(300);
const b = await (await page.$("#copyLatex")).boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForTimeout(600);

const material = await page.evaluate(() => {
  const dock = document.getElementById("officeActionDock");
  const surface = dock.querySelector(".liquid-lens-surface");
  const hl = dock.querySelector(".liquid-lens-highlight");
  const cs = (el, p) =>
    el ? getComputedStyle(el).getPropertyValue(p) : "MISSING";
  const cs2 = (el, p) => (el ? getComputedStyle(el)[p] : "MISSING");
  return {
    surfaceBg: cs(surface, "background-image").slice(0, 120),
    surfaceBgColor: cs2(surface, "backgroundColor"),
    surfaceBlur: cs(surface, "backdrop-filter"),
    surfaceBorder: cs(surface, "border-top-color"),
    highlightBg: cs(hl, "background-image").slice(0, 140),
    highlightBlend: cs(hl, "mix-blend-mode"),
    lensOpacity: cs(dock.querySelector("[data-liquid-lens]"), "opacity"),
    bodyTransparency: cs2(surface, "backgroundColor").match(/[\d.]+\)$/)?.[0],
  };
});
console.log(JSON.stringify(material, null, 1));
await browser.close();
