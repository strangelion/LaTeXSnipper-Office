import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const candidates = [
  process.env.PW_CHROMIUM,
  chromium.executablePath(),
  process.env.PROGRAMFILES &&
    join(
      process.env.PROGRAMFILES,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  process.env.PROGRAMFILES &&
    join(
      process.env.PROGRAMFILES,
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
].filter(Boolean);
const executablePath = candidates.find(existsSync);
if (!executablePath) throw new Error("No Chromium browser is available");

const evidenceIndex = process.argv.indexOf("--evidence");
const evidenceDir =
  evidenceIndex >= 0 ? process.argv[evidenceIndex + 1]?.trim() : "";
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addInitScript(() => {
    localStorage.removeItem("latexsnipper.appearance.v1");
    localStorage.removeItem("latexsnipper.appearance.v2");
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".native-control-shell").length > 0 &&
      document.querySelectorAll(
        "select:not(.native-control-input), input[type=color]:not(.color-control-input)",
      ).length === 0,
  );

  assert.equal(
    await page.locator("select:not(.native-control-input)").count(),
    0,
    "a native select remained visible without the application-owned skin",
  );
  assert.equal(
    await page.locator('input[type="color"]:not(.color-control-input)').count(),
    0,
    "a native colour input remained visible without the application-owned picker",
  );

  const theme = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue("--bg").trim(),
      accent: style.getPropertyValue("--accent").trim(),
    };
  });
  assert.equal(theme.background.toLowerCase(), "#eef6ff");
  assert.equal(theme.accent.toLowerCase(), "#2563eb");

  const center = page.locator("details.formula-style-center");
  await center.evaluate((element) => {
    element.open = true;
  });
  const alignment = page.locator(
    '.native-control-shell[data-control-for="formulaStyleAlignment"]',
  );
  await alignment.locator(".native-control-trigger").click();
  await alignment.locator('.native-control-option[data-value="right"]').click();
  assert.equal(
    await page.locator("#formulaStyleAlignment").inputValue(),
    "right",
  );
  assert.equal(
    await page.evaluate(
      () => window.__app.formulaStyleCenter.getCurrent().layout.alignment,
    ),
    "right",
  );

  await alignment.locator(".native-control-trigger").click();
  if (evidenceDir) {
    await center.screenshot({
      path: join(evidenceDir, "custom-formula-select-light-blue.png"),
    });
  }
  await alignment.locator(".native-control-trigger").click();

  const colour = page.locator(
    '.color-control-shell[data-control-for="formulaStyleColor"]',
  );
  await colour.locator(".color-control-trigger").click();
  await colour.locator('[data-color="#0EA5E9"]').click();
  assert.equal(
    (await page.locator("#formulaStyleColor").inputValue()).toLowerCase(),
    "#0ea5e9",
  );
  assert.equal(
    await page.evaluate(
      () => window.__app.formulaStyleCenter.getCurrent().math.color,
    ),
    "#0EA5E9",
  );
  await colour.locator(".color-control-hex input").fill("#123456");
  await colour.locator(".color-control-hex input").press("Tab");
  assert.equal(
    (await page.locator("#formulaStyleColor").inputValue()).toLowerCase(),
    "#123456",
  );
  const wheel = colour.locator(".color-control-wheel");
  assert.match(
    await wheel.evaluate(
      (element) => getComputedStyle(element, "::before").backgroundImage,
    ),
    /conic-gradient/i,
    "the full-colour wheel spectrum is not visible",
  );
  const wheelBounds = await wheel.boundingBox();
  assert(wheelBounds, "the visual colour wheel is not visible");
  await page.mouse.click(
    wheelBounds.x + wheelBounds.width * 0.07,
    wheelBounds.y + wheelBounds.height * 0.5,
  );
  const wheelHex = (
    await page.locator("#formulaStyleColor").inputValue()
  ).toUpperCase();
  const wheelRgb = [1, 3, 5].map((index) =>
    Number.parseInt(wheelHex.slice(index, index + 2), 16),
  );
  assert(
    wheelRgb[0] > wheelRgb[1] + 70 && wheelRgb[0] > wheelRgb[2] + 70,
    `the visible red side of the colour wheel produced ${wheelHex}`,
  );
  assert.equal(
    await colour.evaluate((element) =>
      Number.parseInt(getComputedStyle(element).zIndex, 10),
    ),
    4200,
    "the open picker was not raised above following content",
  );
  if (evidenceDir) {
    await page.screenshot({
      path: join(evidenceDir, "custom-formula-colour-picker.png"),
    });
  }

  const runtimePolicy = page.locator(
    '.native-control-shell[data-control-for="providerValidationPolicy"]',
  );
  assert.equal(await runtimePolicy.count(), 1);
  assert.equal(
    await runtimePolicy.locator(".native-control-option").count(),
    4,
  );

  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "popoverEdgeFixture";
    fixture.style.cssText =
      "position:fixed;left:20px;bottom:12px;width:240px;z-index:9000";
    fixture.innerHTML = `<select id="popoverEdgeSelect">
      <option>普通</option><option>算子</option><option>二元</option>
      <option>关系</option><option>大型算子</option><option>定界符</option>
    </select>`;
    document.body.appendChild(fixture);
  });
  const edgeSelect = page.locator(
    '.native-control-shell[data-control-for="popoverEdgeSelect"]',
  );
  await edgeSelect.waitFor();
  await edgeSelect.locator(".native-control-trigger").click();
  assert(
    await edgeSelect.evaluate((element) =>
      element.classList.contains("open-up"),
    ),
    "a select near the viewport bottom did not open upward",
  );
  const edgeTriggerBounds = await edgeSelect
    .locator(".native-control-trigger")
    .boundingBox();
  const edgeMenuBounds = await edgeSelect
    .locator(".native-control-menu")
    .boundingBox();
  assert(edgeTriggerBounds && edgeMenuBounds);
  assert(
    edgeMenuBounds.y + edgeMenuBounds.height <= edgeTriggerBounds.y,
    "the upward menu overlaps or extends below its trigger",
  );
  await page
    .locator("#popoverEdgeFixture")
    .evaluate((element) => element.remove());

  for (const selector of [
    ".symbol-palette-panel",
    ".symbol-workbench",
    ".symbol-canvas-toolbar",
  ]) {
    assert.equal(
      await page
        .locator(selector)
        .evaluate((element) => getComputedStyle(element).scrollbarWidth),
      "none",
      `${selector} exposes a layout-consuming scrollbar`,
    );
  }
  const symbolLayout = await page.evaluate(() => {
    const workspace = document.querySelector(".symbol-composer-workspace");
    const palette = document.querySelector(".symbol-palette-panel");
    const workbench = document.querySelector(".symbol-workbench");
    const toolbar = document.querySelector(".symbol-canvas-toolbar");
    return {
      workspaceOverflow: getComputedStyle(workspace).overflow,
      paletteOverflow: getComputedStyle(palette).overflowY,
      workbenchOverflow: getComputedStyle(workbench).overflowY,
      toolbarOverflow: getComputedStyle(toolbar).overflowX,
      toolbarWrap: getComputedStyle(toolbar).flexWrap,
    };
  });
  assert.deepEqual(symbolLayout, {
    workspaceOverflow: "visible",
    paletteOverflow: "visible",
    workbenchOverflow: "visible",
    toolbarOverflow: "visible",
    toolbarWrap: "wrap",
  });
  await page.locator("#symbolComposerModeTab").click();
  const symbolWorkspace = page.locator("#symbolComposerWorkspace");
  await symbolWorkspace.waitFor({ state: "visible" });
  const symbolMetrics = await page.evaluate(() => {
    const workspace = document.querySelector("#symbolComposerWorkspace");
    const palette = workspace.querySelector(".symbol-palette-panel");
    const toolbar = workspace.querySelector(".symbol-canvas-toolbar");
    return {
      paletteWidth: palette.getBoundingClientRect().width,
      paletteOverflow: palette.scrollHeight - palette.clientHeight,
      toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
    };
  });
  assert(symbolMetrics.paletteWidth >= 340, "the symbol palette stayed narrow");
  assert(
    symbolMetrics.paletteOverflow <= 1,
    "the symbol palette still requires nested scrolling",
  );
  assert(
    symbolMetrics.toolbarOverflow <= 1,
    "the canvas toolbar still requires horizontal scrolling",
  );
  if (evidenceDir) {
    await symbolWorkspace.screenshot({
      path: join(evidenceDir, "symbol-workspace-expanded.png"),
    });
  }

  assert.deepEqual(browserErrors, []);
  console.log(
    "PASS: native selects and colour inputs use themed, keyboard-capable application controls; formula persistence and the restored light-blue default are synchronized.",
  );
} finally {
  await browser.close();
}
