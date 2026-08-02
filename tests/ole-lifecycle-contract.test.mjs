import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const activation = readFileSync(
  new URL(
    "../apps/native-office/LaTeXSnipper.Shared/OleFormulaActivation.cs",
    import.meta.url,
  ),
  "utf8",
);
const hostTests = readFileSync(
  new URL(
    "../apps/native-office/LaTeXSnipper.Word.HostTests/Program.cs",
    import.meta.url,
  ),
  "utf8",
);
const adapterSources = ["Word", "Excel", "PowerPoint"].map((host) =>
  readFileSync(
    new URL(
      `../apps/native-office/LaTeXSnipper.${host}/Host/${host}Adapter.cs`,
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.match(activation, /OleActivationResult\s*:\s*IDisposable/);
assert.match(activation, /OwnedTemporaryRcw/);
assert.match(activation, /BorrowedHostRcw/);
assert.match(activation, /TransferredToResult/);
assert.match(activation, /ownership != OleRcwOwnership\.OwnedTemporaryRcw/);
assert.match(activation, /Marshal\.FinalReleaseComObject\(automation\)/);
assert.match(
  activation,
  /if \(initialized && verified\)\s*return OleActivationResult\.Ok\(automation, acquiredOwnership\)/,
);
assert.doesNotMatch(
  activation,
  /OleRcwOwnership acquiredOwnership\s*=/,
  "RCW ownership must be explicit at every activation call site",
);
for (const source of adapterSources) {
  assert.match(
    source,
    /OleFormulaActivation\.ActivateAndVerify\([\s\S]*?OleRcwOwnership\.OwnedTemporaryRcw\)/,
  );
}
assert.match(hostTests, /MaximumBlankGapPixels/);
assert.match(hostTests, /paragraph/i);

console.log("OLE RCW ownership and host evidence contract passed OK");
