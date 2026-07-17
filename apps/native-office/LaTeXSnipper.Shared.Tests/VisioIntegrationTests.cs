using System;
using System.Linq;
using LaTeXSnipper.Visio.Model;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class VisioIntegrationTests
    {
        public static int Run()
        {
            int failures = 0;
            failures += RunCase("metadata roundtrip and chunks", MetadataRoundtrip);
            failures += RunCase("metadata rejects corruption", MetadataCorruption);
            failures += RunCase("metadata rejects non-canonical Base64 and oversized chunks", MetadataStrictEncoding);
            failures += RunCase("metadata enforces maximum size", MetadataSizeLimit);
            failures += RunCase("ShapeSheet string escaping", ShapeSheetEscaping);
            failures += RunCase("placement unit conversion", PlacementConversion);
            failures += RunCase("replacement preserves rotation and flips", PlacementTransform);
            failures += RunCase("document and page context identity", ContextIdentity);
            failures += RunCase("copied formula identity repair", CopiedFormulaIdentity);
            failures += RunCase("replacement keeps original on validation failure", ReplacementRollback);
            failures += RunCase("replacement deletes original after validation", ReplacementCommitOrder);
            failures += RunCase("storage modes select exact render strategy", StorageModeStrategy);
            return failures;
        }

        private static int RunCase(string name, Action test)
        {
            try { test(); Console.WriteLine("PASS Visio " + name); return 0; }
            catch (Exception ex) { Console.Error.WriteLine("FAIL Visio " + name + ": " + ex.Message); return 1; }
        }

        private static void MetadataRoundtrip()
        {
            string json = "{\"formulaId\":\"f_12345678901234567890123456789012\",\"latex\":\"\\\\int_0^1 x dx\",\"revision\":7}";
            var encoded = VisioFormulaMetadataCodec.Encode(json);
            Assert(encoded.SchemaVersion == 3, "schema mismatch");
            Assert(encoded.ChunkCount == encoded.Chunks.Count, "chunk count mismatch");
            Assert(VisioFormulaMetadataCodec.Decode(encoded.SchemaVersion, encoded.ChunkCount, encoded.Sha256, encoded.Chunks) == json, "roundtrip mismatch");
        }

        private static void MetadataCorruption()
        {
            var encoded = VisioFormulaMetadataCodec.Encode("{\"latex\":\"x\"}");
            var chunks = encoded.Chunks.ToArray();
            chunks[0] = (chunks[0][0] == 'A' ? "B" : "A") + chunks[0].Substring(1);
            ExpectThrows(() => VisioFormulaMetadataCodec.Decode(3, chunks.Length, encoded.Sha256, chunks));
            ExpectThrows(() => VisioFormulaMetadataCodec.Decode(2, encoded.ChunkCount, encoded.Sha256, encoded.Chunks));
        }

        private static void MetadataSizeLimit()
        {
            ExpectThrows(() => VisioFormulaMetadataCodec.Encode(new string('x', VisioFormulaMetadataCodec.MaximumPayloadBytes + 1)));
        }

        private static void MetadataStrictEncoding()
        {
            var encoded = VisioFormulaMetadataCodec.Encode("{\"latex\":\"x\"}");
            var whitespace = encoded.Chunks.ToArray();
            whitespace[0] = whitespace[0].Insert(4, " ");
            ExpectThrows(() => VisioFormulaMetadataCodec.Decode(3, whitespace.Length, encoded.Sha256, whitespace));
            ExpectThrows(() => VisioFormulaMetadataCodec.Decode(3, 1, encoded.Sha256,
                new[] { new string('A', VisioFormulaMetadataCodec.ChunkCharacters + 1) }));
        }

        private static void ShapeSheetEscaping()
        {
            Assert(VisioFormulaMetadataCodec.QuoteShapeSheetString("a\"b") == "\"a\"\"b\"", "quote escaping mismatch");
        }

        private static void PlacementConversion()
        {
            var placement = VisioPlacementMath.CenterOnPage(11, 8.5, 144, 72);
            Assert(Math.Abs(placement.PinX - 5.5) < 0.0001, "pinX mismatch");
            Assert(Math.Abs(placement.Width - 2) < 0.0001, "width mismatch");
            Assert(Math.Abs(placement.Height - 1) < 0.0001, "height mismatch");
            ExpectThrows(() => VisioPlacementMath.PointsToInternal(double.NaN));
        }

        private static void PlacementTransform()
        {
            var original = new VisioPlacement(2, 3, 4, 5, 0.75, 1, 1);
            var replacement = VisioPlacementMath.PreserveTransform(original, 144, 72);
            Assert(Math.Abs(replacement.Angle - 0.75) < 0.0001, "angle was not preserved");
            Assert(replacement.FlipX == 1 && replacement.FlipY == 1, "flip state was not preserved");
        }

        private static void ReplacementRollback()
        {
            bool originalDeleted = false;
            bool candidateDeleted = false;
            ExpectThrows(() => VisioReplacementTransaction.Replace(
                () => "candidate",
                _ => throw new InvalidOperationException("invalid metadata"),
                () => originalDeleted = true,
                _ => candidateDeleted = true));
            Assert(!originalDeleted, "original was deleted before validation");
            Assert(candidateDeleted, "failed candidate was not deleted");
        }

        private static void ContextIdentity()
        {
            string first = VisioContextIdentity.ForSavedDocument(@"C:\Documents\Diagram.vsdx");
            string same = VisioContextIdentity.ForSavedDocument(@"c:\documents\diagram.vsdx");
            Assert(first == same && first.Length == 32, "saved document identity is not stable");
            Assert(VisioContextIdentity.Compose(first, 3) == "visio:" + first + ":3", "context composition mismatch");
            Assert(VisioContextIdentity.Compose(first, 4) != VisioContextIdentity.Compose(first, 3), "page identity collision");
        }

        private static void CopiedFormulaIdentity()
        {
            Assert(!VisioContextIdentity.ShouldReassignCopiedFormulaId(7, new[] { 7 }), "unique shape was reassigned");
            Assert(!VisioContextIdentity.ShouldReassignCopiedFormulaId(7, new[] { 7, 9 }), "original shape was reassigned");
            Assert(VisioContextIdentity.ShouldReassignCopiedFormulaId(9, new[] { 7, 9 }), "copied shape was not reassigned");
        }

        private static void ReplacementCommitOrder()
        {
            bool validated = false;
            bool originalDeleted = false;
            string result = VisioReplacementTransaction.Replace(
                () => "candidate",
                _ => validated = true,
                () => { Assert(validated, "original deleted before validation"); originalDeleted = true; },
                _ => throw new InvalidOperationException("cleanup must not run"));
            Assert(result == "candidate" && originalDeleted, "replacement did not commit");
        }

        private static void StorageModeStrategy()
        {
            Assert(VisioStorageModePolicy.Resolve(null) == VisioRenderStrategy.Auto, "null mode is not auto");
            Assert(VisioStorageModePolicy.Resolve("auto") == VisioRenderStrategy.Auto, "auto mode mismatch");
            Assert(VisioStorageModePolicy.Resolve("vector") == VisioRenderStrategy.Vector, "vector mode mismatch");
            Assert(VisioStorageModePolicy.Resolve("image") == VisioRenderStrategy.Image, "image mode mismatch");
            ExpectThrows(() => VisioStorageModePolicy.Resolve("ole"));
            ExpectThrows(() => VisioStorageModePolicy.Resolve("native-omml"));
            ExpectThrows(() => VisioStorageModePolicy.Resolve("unexpected"));
        }

        private static void ExpectThrows(Action action)
        {
            try { action(); }
            catch { return; }
            throw new InvalidOperationException("expected exception was not thrown");
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
