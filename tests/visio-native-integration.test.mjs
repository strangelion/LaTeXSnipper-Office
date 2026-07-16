import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

test("Visio is a Native Office VSTO host on protocol v3", () => {
  const solution = read(
    "apps",
    "native-office",
    "LaTeXSnipper.NativeOffice.sln",
  );
  const csharpProtocol = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Shared",
    "Protocol.cs",
  );
  const rustProtocol = read(
    "src-tauri",
    "src",
    "platforms",
    "pipe_protocol.rs",
  );
  const session = read("src-tauri", "src", "platforms", "session.rs");
  assert.match(solution, /LaTeXSnipper\.Visio\\LaTeXSnipper\.Visio\.csproj/);
  assert.match(csharpProtocol, /public const int Version = 3/);
  assert.match(rustProtocol, /pub const PROTOCOL_VERSION: u32 = 3/);
  assert.match(session, /"visio" => Some\(Self::Visio\)/);
  assert.match(csharpProtocol, /JsonPropertyName\("features"\)/);
  assert.match(rustProtocol, /pub features: HashMap<String, bool>/);
});

test("Visio formulas use bounded checksummed ShapeSheet metadata", () => {
  const codec = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Model",
    "VisioFormulaMetadataCodec.cs",
  );
  const adapter = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Host",
    "VisioAdapter.cs",
  );
  assert.match(codec, /SchemaVersion = 3/);
  assert.match(codec, /MaximumPayloadBytes = 256 \* 1024/);
  assert.match(codec, /MaximumChunks = 64/);
  assert.match(codec, /StrictBase64\.Decode/);
  assert.match(codec, /chunk\.Length > ChunkCharacters/);
  assert.match(codec, /FixedTimeEqualsHex/);
  assert.match(adapter, /LaTeXSnipperPayloadChunkCount/);
  assert.match(adapter, /LaTeXSnipperPayloadSha256/);
  assert.match(adapter, /ReadMetadata\(candidate\)/);
});

test("Visio insertion is vector-first with explicit PNG fallback and no OLE claim", () => {
  const adapter = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Host",
    "VisioAdapter.cs",
  );
  const addin = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "ThisAddIn.cs",
  );
  assert.match(adapter, /VisioOwnedTempFile\.FromSvg/);
  assert.match(adapter, /page\.Import\(temp\.Path\)/);
  assert.match(adapter, /VISIO_SVG_IMPORT_FAILED/);
  assert.match(adapter, /VISIO_VECTOR_SVG_REQUIRED/);
  assert.match(adapter, /VISIO_VECTOR_IMPORT_FAILED/);
  assert.match(adapter, /requiresVector/);
  assert.match(adapter, /VisioOwnedTempFile\.FromPng/);
  assert.match(adapter, /VISIO_OLE_EXPERIMENTAL/);
  assert.doesNotMatch(adapter, /AddOLEObject|OLEFormat|OleFormulaInterop/);
  assert.match(addin, /\["visio\.ole"\] = false/);
  assert.match(addin, /"vector" => "vector"/);
});

test("Visio mutation remains selection-scoped and replacement is candidate-first", () => {
  const adapter = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Host",
    "VisioAdapter.cs",
  );
  const transaction = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Model",
    "VisioReplacementTransaction.cs",
  );
  assert.match(adapter, /selection\.Count != 1/);
  assert.match(adapter, /VISIO_GROUPED_UPDATE_UNSAFE/);
  assert.match(adapter, /VISIO_REVISION_CONFLICT/);
  assert.match(adapter, /ReadOptionalCell\(shape, "FlipX"\)/);
  assert.match(
    adapter,
    /WriteOptionalCell\(shape, "FlipY", placement\.FlipY\)/,
  );
  assert.match(
    transaction,
    /validateCandidate\(candidate\);\s*deleteOriginal\(\);/s,
  );
  assert.match(transaction, /deleteCandidate\(candidate\)/);
});

test("Visio payload is staged, installed, verified, and excluded off Windows", () => {
  const installer = read(
    "apps",
    "native-office",
    "Installer",
    "WiX",
    "LaTeXSnipper.NativeOffice.wxs",
  );
  const staging = read("scripts", "stage-resources.ps1");
  const packageVerifier = read("scripts", "verify-package-contents.ps1");
  const manifestVerifier = read("scripts", "verify-vsto-manifests.ps1");
  const nonWindowsVerifier = read("scripts", "verify-package-contents.ps1");
  assert.match(installer, /VisioComponent/);
  assert.match(
    installer,
    /Office\\Visio\\Addins\\LaTeXSnipper\.NativeOffice\.Visio/,
  );
  assert.match(staging, /"Word", "Excel", "PowerPoint", "Visio"/);
  assert.match(packageVerifier, /"Word", "Excel", "PowerPoint", "Visio"/);
  assert.match(manifestVerifier, /"Word", "Excel", "PowerPoint", "Visio"/);
  assert.match(
    nonWindowsVerifier,
    /Windows NativeOffice content found in non-Windows package/,
  );
});

test("Office.js host adapters do not invent a Visio web host", () => {
  const officeAddinFiles = fs
    .readdirSync(path.join("apps", "office-addin", "src", "adapters"))
    .filter((name) => name.endsWith(".ts"));
  const source = officeAddinFiles
    .map((name) => read("apps", "office-addin", "src", "adapters", name))
    .join("\n");
  assert.doesNotMatch(source, /["']visio["']/i);
});

test("installed activation probes use the registered DLL for each bitness", () => {
  const gate = read("scripts", "invoke-native-office-activation-gate.ps1");
  assert.match(gate, /RegistryView\]::Registry64/);
  assert.match(gate, /RegistryView\]::Registry32/);
  assert.match(gate, /Get-RegisteredOleDll/);
  assert.doesNotMatch(
    gate,
    /ExistingRegistration[\s\S]*Join-Path \$StagingRoot "OleFormulaObject\.x64\.dll"/,
  );
});
