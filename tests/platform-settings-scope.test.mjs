import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/platform/settings-scope.js", import.meta.url),
  "utf8",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { resolveScopedSetting, scopedSettingKey, migrateLegacySetting } =
  await import(moduleUrl);

const settings = {
  "scoped.global.global.theme": "light",
  "scoped.os.windows.theme": "dark",
  "scoped.host.word.theme": "office",
};
assert.equal(
  resolveScopedSetting(settings, "theme", {
    os: "windows",
    host: "word",
  }),
  "office",
);
assert.equal(
  scopedSettingKey("document", "formulaMode", { documentId: "doc-1" }),
  "scoped.document.doc-1.formulaMode",
);
assert.equal(
  migrateLegacySetting({ old: true }, "old", "scoped.global.global.new")[
    "scoped.global.global.new"
  ],
  true,
);

console.log("Platform settings scope contracts passed OK");
