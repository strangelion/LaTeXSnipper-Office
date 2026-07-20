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

test("Visio storage modes select auto, vector, image, and unsupported paths", () => {
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
  const policy = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Model",
    "VisioStorageModePolicy.cs",
  );
  assert.match(adapter, /VisioOwnedTempFile\.FromSvg/);
  assert.match(adapter, /page\.Import\(temp\.Path\)/);
  assert.match(adapter, /VISIO_SVG_IMPORT_FAILED/);
  assert.match(adapter, /VISIO_VECTOR_SVG_REQUIRED/);
  assert.match(adapter, /VISIO_VECTOR_IMPORT_FAILED/);
  assert.match(adapter, /requiresVector/);
  assert.match(adapter, /VisioOwnedTempFile\.FromPng/);
  assert.match(adapter, /strategy == VisioRenderStrategy\.Image/);
  assert.match(adapter, /VISIO_IMAGE_PNG_REQUIRED/);
  assert.match(adapter, /VISIO_OLE_EXPERIMENTAL/);
  assert.doesNotMatch(adapter, /AddOLEObject|OLEFormat|OleFormulaInterop/);
  assert.match(policy, /case "auto":\s*return VisioRenderStrategy\.Auto/s);
  assert.match(policy, /case "vector":/);
  assert.match(policy, /case "image":/);
  assert.match(policy, /VISIO_OLE_UNSUPPORTED/);
  assert.match(policy, /VISIO_NATIVE_UNSUPPORTED/);
  assert.match(addin, /\["visio\.ole"\] = false/);
  assert.match(addin, /"vector" => "vector"/);
});

test("Visio Ribbon opens a revision-aware desktop edit transaction", () => {
  const ribbon = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Visio",
    "Ribbon",
    "VisioRibbonExtensibility.cs",
  );
  assert.match(ribbon, /case "readSelection":/);
  assert.match(ribbon, /new VstoOpenEditor/);
  assert.match(ribbon, /Action = "edit"/);
  assert.match(ribbon, /Latex = payload\.Latex/);
  assert.match(ribbon, /Omml = payload\.Omml/);
  assert.match(ribbon, /FormulaId = payload\.FormulaId/);
  assert.match(ribbon, /Revision = payload\.Revision/);
  assert.match(ribbon, /SourceHost = "visio"/);
  assert.doesNotMatch(ribbon, /ReadFormulaPrefix.*payload\.Latex/);
});

test("all Native Office hosts share reconnect and Ribbon refresh lifecycle", () => {
  const coordinator = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Shared",
    "PipeReconnectCoordinator.cs",
  );
  assert.match(
    coordinator,
    /while \(!cancellationToken\.IsCancellationRequested\)/,
  );
  assert.match(coordinator, /SetConnected\(true\)/);
  assert.match(coordinator, /SetConnected\(false\)/);

  for (const host of ["Word", "Excel", "PowerPoint", "Visio"]) {
    const addin = read(
      "apps",
      "native-office",
      `LaTeXSnipper.${host}`,
      "ThisAddIn.cs",
    );
    assert.match(addin, /new PipeReconnectCoordinator\(/, host);
    assert.match(addin, /\.Disconnected \+= .*disconnected\(\)/, host);
    assert.match(addin, /NotifyConnectionChanged\(\)/, host);
    assert.doesNotMatch(addin, /attempt <= 60/, host);
  }
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
  assert.match(
    staging,
    /NativeOffice.*installer.*MSI|installer.*payload|sole owner/,
  );
  assert.match(packageVerifier, /MSI|installer/);
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
