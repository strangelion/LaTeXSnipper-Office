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

async function lensState(sel) {
  return page.evaluate((s) => {
    const root = document.querySelector(s);
    const get = (v) => parseFloat(root.style.getPropertyValue(v));
    const btn = root.querySelector(".nav-tab.active");
    const btnRect = btn?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const lensLeft = rootRect.left + get("--liquid-lens-x");
    const lensW = get("--liquid-lens-w");
    const lensCenter = lensLeft + lensW / 2;
    const btnCenter = btnRect ? btnRect.left + btnRect.width / 2 : -1;
    return {
      visible: root.dataset.lensVisible,
      lensCenter: Math.round(lensCenter * 10) / 10,
      btnCenter: Math.round(btnCenter * 10) / 10,
      off: Math.round(Math.abs(lensCenter - btnCenter) * 10) / 10,
      x: Math.round(get("--liquid-lens-x") * 10) / 10,
    };
  }, sel);
}

// Initial: active = 编辑
const init = await lensState(".liquid-nav");
console.log("INITIAL (active=编辑):", JSON.stringify(init));

// Hover 识别 tab -> lens should follow mouse (hoverItem wins)
const ocr = await (await page.$("#ocrBtn")).boundingBox();
await page.mouse.move(ocr.x + ocr.width / 2, ocr.y + ocr.height / 2);
await page.waitForTimeout(700);
const hoverOcr = await lensState(".liquid-nav");
console.log("HOVER 识别:", JSON.stringify(hoverOcr));

// Click 公式库 -> active changes, lens follows the NEW active tab
const hist = await (await page.$("#historyBtn")).boundingBox();
await page.mouse.click(hist.x + hist.width / 2, hist.y + hist.height / 2);
await page.waitForTimeout(700);
const clickHist = await lensState(".liquid-nav");
console.log("CLICK 公式库:", JSON.stringify(clickHist));
const activeAfter = await page.evaluate(() =>
  document.querySelector(".liquid-nav .nav-tab.active")?.id,
);
console.log("active after click:", activeAfter);

// Move mouse away (leave nav) -> lens should stay on active tab
await page.mouse.move(30, 500);
await page.waitForTimeout(800);
const away = await lensState(".liquid-nav");
console.log("LEAVE NAV (should stick to active):", JSON.stringify(away));

// Bottom dock: hover 复制LaTeX -> lens visible & aligned
const copyLatex = await page.$("#copyLatex");
await copyLatex.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const cb = await copyLatex.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.waitForTimeout(600);
const dock = await page.evaluate(() => {
  const root = document.getElementById("officeActionDock");
  const get = (v) => parseFloat(root.style.getPropertyValue(v));
  const btn = document.getElementById("copyLatex");
  const br = btn.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const lensCenter = rr.left + get("--liquid-lens-x") + get("--liquid-lens-w") / 2;
  const btnCenter = br.left + br.width / 2;
  return {
    visible: root.dataset.lensVisible,
    lensOpacity: getComputedStyle(root.querySelector("[data-liquid-lens]")).opacity,
    off: Math.round(Math.abs(lensCenter - btnCenter) * 10) / 10,
  };
});
console.log("BOTTOM DOCK hover 复制LaTeX:", JSON.stringify(dock));
console.log("ERRORS:", errors.join(" | ") || "none");
await browser.close();
