// Animation smoothness verification: samples the lens position, bridge
// presence and highlight over the glide, proving single-clock motion.
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

const dock = await page.$("#officeActionDock");
await dock.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

const b1 = await (await page.$("#copyLatex")).boundingBox();
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
await page.waitForTimeout(800);

const b2 = await (await page.$("#copySvg")).boundingBox();
const start = Date.now();
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);

const samples = [];
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => {
    const d = document.getElementById("officeActionDock");
    const get = (v) => parseFloat(d.style.getPropertyValue(v));
    return {
      x: get("--liquid-lens-x"),
      w: get("--liquid-lens-w"),
      bridge: d.dataset.bridgeVisible,
      bw: get("--liquid-bridge-w"),
      hx: parseFloat(d.style.getPropertyValue("--liquid-lens-highlight-x")),
      scale: get("--liquid-scale-x"),
    };
  });
  samples.push(s);
  await page.waitForTimeout(30);
}
const dur = Date.now() - start;

console.log("sample count:", samples.length, "window:", dur + "ms");
console.log("x path:", samples.map((s) => Math.round(s.x)).join(" "));
console.log("w path:", samples.map((s) => Math.round(s.w)).join(" "));
console.log(
  "bridge visible frames:",
  samples.filter((s) => s.bridge === "true").length,
);
console.log(
  "bridge width path:",
  samples.map((s) => Math.round(s.bw)).join(" "),
);
console.log(
  "highlight x path:",
  samples.map((s) => Math.round(s.hx)).join(" "),
);
console.log("scale x path:", samples.map((s) => s.scale.toFixed(3)).join(" "));

const xs = samples.map((s) => s.x);
let monotonic = true;
for (let i = 1; i < xs.length; i++) {
  if (xs[i] < xs[i - 1]) {
    monotonic = false;
    break;
  }
}
console.log("monotonic x glide:", monotonic);
console.log(
  "bridge appeared during glide:",
  samples.some((s) => s.bridge === "true"),
);
console.log(
  "bridge visible across frames (strand):",
  samples.filter((s) => s.bridge === "true").length >= 2,
);
console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
await browser.close();
