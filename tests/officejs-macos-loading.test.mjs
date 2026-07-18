import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const read = (...parts) => fs.readFileSync(path.resolve(...parts), "utf8");
const manifests = [
  ["word.xml", "manifest.word.desktop.xml"],
  ["excel.xml", "manifest.excel.desktop.xml"],
  ["powerpoint.xml", "manifest.powerpoint.desktop.xml"],
];

for (const [stagedName, sourceName] of manifests) {
  for (const [label, xml] of [
    [
      "staged",
      read("src-tauri", "resources", "OfficeJS", "manifest", stagedName),
    ],
    ["source", read("apps", "office-addin", "manifests", sourceName)],
  ]) {
    test(`${stagedName} ${label} manifest uses canonical IPv4 loopback HTTPS`, () => {
      assert.match(xml, /https:\/\/127\.0\.0\.1:19876/);
      assert.doesNotMatch(xml, /https:\/\/localhost:19876/);
      assert.doesNotMatch(xml, /http:\/\/127\.0\.0\.1:19876/);
    });
  }
}

test("PowerPoint commands are not globally gated on PowerPointApi 1.10", () => {
  const xml = read(
    "src-tauri",
    "resources",
    "OfficeJS",
    "manifest",
    "powerpoint.xml",
  );
  assert.match(xml, /DefaultMinVersion="1\.1"/);
  assert.doesNotMatch(xml, /DefaultMinVersion="1\.10"/);
  const source = read(
    "apps",
    "office-addin",
    "manifests",
    "manifest.powerpoint.desktop.xml",
  );
  assert.match(source, /DefaultMinVersion="1\.1"/);
  assert.doesNotMatch(source, /DefaultMinVersion="1\.10"/);
  const deployed = read("office-deploy", "manifest", "powerpoint.xml");
  assert.match(deployed, /DefaultMinVersion="1\.1"/);
  assert.doesNotMatch(deployed, /DefaultMinVersion="1\.10"/);
});

test("Office.js staging preserves the canonical local endpoint", () => {
  const source = read("scripts", "stage-office-addin.mjs");
  assert.match(
    source,
    /const localOfficeBase = "https:\/\/127\.0\.0\.1:19876"/,
  );
  assert.doesNotMatch(
    source,
    /const localOfficeBase = "https:\/\/localhost:19876"/,
  );
});

test("macOS certificate trust targets the login keychain and verifies SSL trust", () => {
  const source = read("src-tauri", "src", "platforms", "tls_cert.rs");
  assert.match(source, /login\.keychain-db/);
  assert.match(source, /"add-trusted-cert"\.into\(\)/);
  assert.match(source, /"trustRoot"\.into\(\)/);
  assert.match(source, /"verify-cert"/);
  assert.match(source, /\.arg\("127\.0\.0\.1"\)/);
  assert.match(source, /pub fn ensure_default_tls_certificate/);
  assert.match(source, /pub fn get_tls_certificate_status/);
  assert.doesNotMatch(source, /Cert trust not implemented for non-Windows/);
  for (const functionName of [
    "default_key_path",
    "ensure_default_tls_certificate",
    "try_trust_cert_from_appdata",
    "try_trust_cert",
  ]) {
    assert.match(
      source,
      new RegExp(
        `#\\[cfg\\(any\\(target_os = "windows", target_os = "macos"\\)\\)\\]\\s*(?:pub )?fn ${functionName}`,
      ),
    );
  }
});

test("macOS Office.js uninstall removes only the recorded certificate fingerprint", () => {
  const tls = read("src-tauri", "src", "platforms", "tls_cert.rs");
  const integrations = read("src-tauri", "src", "platforms", "integrations.rs");

  assert.match(tls, /trusted-certificate\.sha256/);
  assert.match(tls, /fn certificate_sha256_from_pem_bytes/);
  assert.match(tls, /"delete-certificate"\.into\(\)/);
  assert.match(tls, /"-Z"\.into\(\)/);
  assert.match(tls, /"-t"\.into\(\)/);
  assert.match(tls, /pub fn remove_owned_macos_certificate_trust/);
  assert.match(tls, /OFFICEJS_TLS_OWNERSHIP_MISMATCH/);
  const deleteArgsStart = tls.indexOf("fn macos_delete_command_args");
  const deleteArgsEnd = tls.indexOf("#[cfg", deleteArgsStart + 1);
  assert.ok(deleteArgsStart >= 0 && deleteArgsEnd > deleteArgsStart);
  assert.doesNotMatch(tls.slice(deleteArgsStart, deleteArgsEnd), /localhost/);
  assert.match(
    integrations,
    /super::tls_cert::remove_owned_macos_certificate_trust\(\)/,
  );
  assert.match(integrations, /OFFICEJS_UNINSTALL_FAILED/);
  assert.match(integrations, /office-js-uninstall/);
});

test("Office.js installation fails closed before manifest installation when TLS trust fails", () => {
  const source = read("src-tauri", "src", "platforms", "integrations.rs");
  const trust = source.indexOf("ensure_office_js_tls_trust()");
  const validation = source.indexOf("validate_office_js_manifest(*host", trust);
  const install = source.indexOf("install_office_js_addin_at", validation);
  assert.ok(trust >= 0 && validation > trust && install > validation);
  assert.match(source, /OFFICEJS_TLS_TRUST_FAILED/);
  assert.match(
    source,
    /PlatformIntegrationResult::fail\("office-web", "tls-trust", error\)/,
  );
  assert.doesNotMatch(source, /Certificate trust deferred/);
});

test("Office.js diagnostics expose five states and the settings repair action", () => {
  const integrations = read("src-tauri", "src", "platforms", "integrations.rs");
  const bridge = read("src-tauri", "src", "platforms", "office_bridge.rs");
  const main = read("src-tauri", "src", "main.rs");
  const frontend = read("src", "main.js");

  for (const state of [
    "not-installed",
    "manifest-installed",
    "tls-untrusted",
    "ready",
    "connected",
  ]) {
    assert.match(integrations, new RegExp(`"${state}"`));
  }
  assert.match(integrations, /pub struct OfficeWebDiagnostics/);
  assert.match(integrations, /pub async fn get_office_web_diagnostics/);
  assert.match(bridge, /pub\(crate\) fn office_taskpane_assets_present/);
  assert.match(main, /integrations::get_office_web_diagnostics/);
  assert.match(frontend, /invoke\("get_office_web_diagnostics"\)/);
  assert.match(
    frontend,
    /invoke\("install_platform_integration", \{ platformId: "office-web" \}\)/,
  );
  assert.match(frontend, /data-office-web-repair/);
  assert.doesNotMatch(integrations, /OFFICEJS_OFFICE_NOT_DETECTED/);
  assert.doesNotMatch(
    integrations,
    /let required_manifests_ready = office\.installed/,
  );
  assert.match(
    integrations,
    /#\[cfg\(any\(target_os = "windows", target_os = "macos"\)\)\]\s*fn office_js_manifests/,
  );
  assert.match(
    integrations,
    /#\[cfg\(any\(target_os = "windows", target_os = "macos"\)\)\]\s*fn find_office_js_manifest/,
  );
});
