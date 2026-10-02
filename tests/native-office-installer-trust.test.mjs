import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const installerRoot = path.join("apps", "native-office", "Installer");

test("Native Office installer trusts self-signed VSTO publishers without over-trusting CA certificates", () => {
  const build = read(installerRoot, "build.ps1");
  const wix = read(installerRoot, "WiX", "LaTeXSnipper.NativeOffice.wxs");

  assert.match(
    build,
    /\$trustSigningCertificateAsRoot = \$storeCert\.Subject -eq \$storeCert\.Issuer/,
  );
  assert.match(build, /selfSigned\s*=\s*\$trustSigningCertificateAsRoot/);
  assert.match(
    build,
    /-d TrustSigningCertificateAsRoot=\$\(\$trustSigningCertificateAsRoot\.ToString\(\)\.ToLowerInvariant\(\)\)/,
  );

  assert.match(
    wix,
    /Id="VstoTrustedPublisher"[\s\S]*?StoreName="trustedPublisher"/,
  );
  assert.match(
    wix,
    /<\?if \$\(var\.TrustSigningCertificateAsRoot\) = "true" \?>[\s\S]*?Id="VstoSelfSignedRoot"[\s\S]*?StoreName="root"[\s\S]*?<\?endif \?>/,
  );
});
