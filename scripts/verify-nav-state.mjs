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

// 1. Nav tabs current styling
const navTabs = await page.evaluate(() => {
  const nav = document.querySelector(".liquid-nav");
  const tabs = [...nav.querySelectorAll(".nav-tab")];
  const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
  const cs2 = (el, p) => getComputedStyle(el)[p];
  return {
    activeId: nav.querySelector(".nav-tab.active")?.id,
    lensVisible: nav.dataset.lensVisible,
    lensOpacity: cs(nav.querySelector("[data-liquid-lens]"), "opacity"),
    tabs: tabs.map((t) => ({
      id: t.id,
      active: t.classList.contains("active"),
      bg: cs2(t, "backgroundColor"),
      color: cs2(t, "color"),
      shadow: cs(t, "box-shadow").slice(0, 60),
    })),
  };
});
console.log("NAV TABS:", JSON.stringify(navTabs, null, 1));

// 2. Command bar buttons
const cmd = await page.evaluate(() => {
  const bar = document.querySelector('[role="toolbar"]');
  const clusters = bar.querySelectorAll(".workspace-command-cluster");
  const cs2 = (el, p) => getComputedStyle(el)[p];
  return {
    clusterCount: clusters.length,
    buttons: [...bar.querySelectorAll("button")].slice(0, 10).map((b) => ({
      cls: b.className || "(none)",
      text: b.textContent.trim(),
      bg: cs2(b, "backgroundColor"),
    })),
  };
});
console.log("CMD BAR:", JSON.stringify(cmd, null, 1));
console.log("ERRORS:", errors.join(" | ") || "none");
await browser.close();
