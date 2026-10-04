import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const executablePath = [
  chromium.executablePath(),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
]
  .filter(Boolean)
  .find(existsSync);
if (!executablePath) throw new Error("No Chromium browser is available");
const browser = await chromium.launch({ executablePath, headless: true });
const directory = "output/playwright/office-batch-taskpane";
mkdirSync(directory, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const failures = [];
  let workspaceRequests = 0;
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) => failures.push(request.url()));
  await page.addInitScript(() => {
    const state = (window.__batchFixture = {
      writes: [],
      releases: [],
      metadataAdds: 0,
      metadataDeletes: 0,
      ranges: [],
    });
    const sources = [
      "$x^2$",
      "```latex",
      "$ignored$",
      "```",
      "$x^2$",
      "prefix $x^2$ suffix",
    ];
    state.ranges = sources.map((text, index) => ({
      index,
      text,
      xml: `<w:r><w:t>${text}</w:t></w:r>`,
      load() {},
      track() {},
      untrack() {
        state.releases.push(index);
      },
      parentContentControlOrNullObject: { isNullObject: true, load() {} },
      contentControls: { items: [], load() {} },
      getOoxml() {
        return { value: this.xml };
      },
      insertOoxml(xml) {
        state.writes.push(index);
        this.xml = xml;
        this.text = "";
      },
    }));
    const context = {
      document: {
        body: {
          paragraphs: {
            load() {},
            items: state.ranges.map((range) => ({
              get text() {
                return range.text;
              },
              getRange() {
                return range;
              },
            })),
          },
        },
        getSelection() {
          throw new Error("Batch must not use the new active selection");
        },
      },
      async sync() {},
    };
    window.Word = {
      RangeLocation: { content: "Content" },
      InsertLocation: { replace: "Replace" },
      async run(...args) {
        return args.at(-1)(context);
      },
    };
    window.Office = {
      onReady(callback) {
        queueMicrotask(() => callback({ host: "Word" }));
      },
      AsyncResultStatus: { Succeeded: "succeeded" },
      context: {
        host: "Word",
        document: {
          url: "fixture-document",
          customXmlParts: {
            addAsync(_xml, callback) {
              state.metadataAdds++;
              callback({
                status: "succeeded",
                value: {
                  deleteAsync(done) {
                    state.metadataDeletes++;
                    done({ status: "succeeded" });
                  },
                },
              });
            },
          },
        },
      },
    };
  });
  await page.route("**/appsforoffice.microsoft.com/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route("**/assets/taskpane-*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (!/^[\w.-]+$/.test(name)) throw new Error("Unexpected asset path");
    return route.fulfill({
      contentType: name.endsWith(".css")
        ? "text/css"
        : "application/javascript",
      body: readFileSync(join("office-deploy/assets", name)),
    });
  });
  await page.route("**/api/office/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("open-workspace")) workspaceRequests++;
    const body = path.endsWith("convert/v1")
      ? {
          success: true,
          content:
            '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x²</m:t></m:r></m:oMath>',
        }
      : path.endsWith("poll-actions")
        ? { actions: [] }
        : { success: true, actions: [] };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/office-batch-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: readFileSync("office-deploy/taskpane.html"),
    }),
  );
  await page.goto("http://127.0.0.1:2100/office-batch-test", {
    waitUntil: "networkidle",
  });
  const button = page.locator('[data-workspace="batch"]');
  await button.click();
  const dialog = page.locator("dialog.office-batch-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => window.__batchFixture.writes.length),
    0,
  );
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: join(directory, "confirmation-narrow.png") });
  await page.keyboard.press("Escape");
  await page.locator("#status").filter({ hasText: "已取消" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__batchFixture.metadataAdds),
    0,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__batchFixture.releases.sort()),
    [0, 4],
  );
  await button.click();
  await dialog.getByRole("button", { name: "确认转换 2 条" }).click();
  await page.locator("#status").filter({ hasText: "转换结束：2/2" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.__batchFixture.writes),
    [4, 0],
  );
  assert.equal(workspaceRequests, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    "PASS: production Office.js button starts in-pane batch scan, cancel is read-only, duplicate tracked ranges commit once, fenced/mixed prose skipped, progress/result and 390px confirmation. Office APIs are fixtures, not real Office acceptance.",
  );
} finally {
  await browser.close();
}
