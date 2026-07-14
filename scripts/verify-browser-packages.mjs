import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(
  import.meta.dirname,
  "..",
  "apps",
  "browser-extension",
  "dist",
);
const required = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "sidepanel.html",
  "options.html",
  "provenance.json",
  "THIRD_PARTY_LICENSES.txt",
  "_locales/en/messages.json",
  "_locales/zh_CN/messages.json",
  "_locales/zh_TW/messages.json",
];
for (const target of ["chrome", "firefox"]) {
  const targetRoot = resolve(root, target);
  for (const file of required) {
    const path = resolve(targetRoot, file);
    if (statSync(path).size === 0)
      throw new Error(`${target} package contains an empty ${file}`);
  }
  const manifest = JSON.parse(
    readFileSync(resolve(targetRoot, "manifest.json"), "utf8"),
  );
  const serialized = JSON.stringify(manifest);
  if (serialized.includes("<all_urls>") || serialized.includes("19876"))
    throw new Error(
      `${target} manifest violates permission or Bridge port policy`,
    );
  if (!serialized.includes("19877") || manifest.default_locale !== "en")
    throw new Error(
      `${target} manifest is missing the Bridge or locale contract`,
    );
  const provenance = JSON.parse(
    readFileSync(resolve(targetRoot, "provenance.json"), "utf8"),
  );
  if (
    provenance.target !== target ||
    provenance.conversationSchema !== 1 ||
    provenance.providers.length < 13
  )
    throw new Error(`${target} provenance is incomplete`);
}
console.log("Verified complete Chrome and Firefox browser packages.");
