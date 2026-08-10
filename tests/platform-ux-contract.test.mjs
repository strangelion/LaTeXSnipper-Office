import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/main.js", "utf8");
const styles = readFileSync("src/styles/main.css", "utf8");

test("Windows Office receives a native-capability card treatment", () => {
  assert.match(source, /platformContext\.os === "windows"/);
  assert.match(source, /platform-native-badges/);
  for (const capability of ["VSTO 会话", "OMML", "OLE", "DirectML"]) {
    assert.match(source, new RegExp(capability));
  }
  assert.match(styles, /\.platform-quick-card\.is-windows-native/);
});

test("offline ecosystem state no longer occupies the primary editor action row", () => {
  const selector = source.slice(
    source.indexOf("async refreshEcosystemTargetSelector"),
    source.indexOf("async refreshEcosystemClients"),
  );
  assert.match(selector, /container\.style\.display = "none"/);
  assert.match(selector, /insertButton\.style\.display = "none"/);
  assert.match(selector, /platform\.id === target && platform\.enabled/);
});
