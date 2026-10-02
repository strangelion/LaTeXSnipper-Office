import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const installerRoot = path.join("apps", "native-office", "Installer");
const trustScript = path.join("scripts", "trust-native-office-certificate.ps1");

test("Native Office installer trusts the VSTO publisher without writing the root store", () => {
  const build = read(installerRoot, "build.ps1");
  const wix = read(installerRoot, "WiX", "LaTeXSnipper.NativeOffice.wxs");

  // The self-signed detection stays, but only as recorded metadata.
  assert.match(
    build,
    /\$trustSigningCertificateAsRoot = \$storeCert\.Subject -eq \$storeCert\.Issuer/,
  );
  assert.match(build, /selfSigned\s*=\s*\$trustSigningCertificateAsRoot/);

  // The MSI must not receive the root-store switch any more: a WiX certificate
  // action against the current-user root store blocks msiexec when the package
  // runs without an interactive desktop session.
  assert.doesNotMatch(build, /TrustSigningCertificateAsRoot=/);

  assert.match(
    wix,
    /Id="VstoTrustedPublisher"[\s\S]*?StoreName="trustedPublisher"/,
  );
  assert.doesNotMatch(wix, /StoreName="root"/);
  assert.doesNotMatch(wix, /VstoSelfSignedRoot/);
  assert.doesNotMatch(wix, /TrustSigningCertificateAsRoot/);
});

test("Native Office certificate trust script gates root trust on selfSigned", () => {
  assert.ok(fs.existsSync(trustScript), `${trustScript} is missing`);
  const script = read(trustScript);

  assert.match(
    script,
    /\[\s*System\.Security\.Cryptography\.X509Certificates\.StoreName\s*\]::TrustedPublisher/,
  );
  assert.match(
    script,
    /if \(\[bool\]\$metadata\.selfSigned\) \{[\s\S]*?StoreName\s*\]::Root[\s\S]*?\}/,
  );
  // Non-interactive store writes only: Import-Certificate can pop a UI prompt
  // for the root store when no interactive session is available.
  assert.doesNotMatch(script, /Import-Certificate/);
  assert.match(script, /sha256Thumbprint/);
});

test("Windows package verification applies Native Office certificate trust before installing", () => {
  const workflow = read(".github", "workflows", "package-verify.yml");
  const trustStep = workflow.indexOf("trust-native-office-certificate.ps1");
  const installStep = workflow.indexOf(
    "name: Install, activate, same-version reinstall, cross-version upgrade, and uninstall",
  );

  assert.notEqual(
    trustStep,
    -1,
    "package-verify.yml does not apply certificate trust",
  );
  assert.notEqual(
    installStep,
    -1,
    "package-verify.yml install step was renamed",
  );
  assert.ok(
    trustStep < installStep,
    "certificate trust must run before the MSI install step",
  );
});
