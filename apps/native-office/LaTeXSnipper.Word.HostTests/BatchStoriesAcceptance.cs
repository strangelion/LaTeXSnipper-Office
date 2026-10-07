using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class BatchStoriesAcceptance
    {
        public static int Run(W.Application application, ref W.Document document,
            AcceptanceCase fixture, string directory)
        {
            var watch = Stopwatch.StartNew();
            var checks = new List<object>();
            string error = null;
            bool reopened = false;
            try
            {
                document.Content.Text = "Emoji\ud83d\ude00 $x^2$ Repeat $x^2$ Long $" + new string('a', 300) +
                    "$ End\rMultiline $$a\r+b$$ After\r";
                var lexicalCandidates = new WordBatchLatexScanner(application).Scan();
                Require(lexicalCandidates.Count == 4, "Duplicate/Unicode/long-formula/multiline locator scan lost a candidate.");
                foreach (var candidate in lexicalCandidates)
                {
                    var actual = document.Range(candidate.Locator.Value.GetProperty("start").GetInt32(),
                        candidate.Locator.Value.GetProperty("end").GetInt32());
                    Require(actual.Text == candidate.Source, "Locator did not exactly match duplicate/Unicode/long source.");
                    Marshal.ReleaseComObject(actual);
                }
                checks.Add(new { name = "duplicate-unicode-long-multiline-locators", count = lexicalCandidates.Count });
                document.Content.Text = "BodyBefore $" + fixture.Latex + "$ BodyAfter\r";
                var end = document.Range(document.Content.End - 1, document.Content.End - 1);
                end.InsertBreak(W.WdBreakType.wdSectionBreakNextPage);
                for (int index = 1; index <= 2; index++)
                {
                    var section = document.Sections[index];
                    var header = section.Headers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary];
                    var footer = section.Footers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary];
                    header.LinkToPrevious = false;
                    footer.LinkToPrevious = false;
                    // Same lengths and offsets in distinct unlinked stories must not deduplicate.
                    header.Range.Text = "Header" + index + "Before $" + fixture.Latex + "$ Header" + index + "After\r";
                    footer.Range.Text = "Footer" + index + "Before $" + fixture.Latex + "$ Footer" + index + "After\r";
                }
                var second = document.Sections[2];
                second.PageSetup.DifferentFirstPageHeaderFooter = -1;
                var firstPage = second.Headers[W.WdHeaderFooterIndex.wdHeaderFooterFirstPage];
                firstPage.LinkToPrevious = false;
                firstPage.Range.Text = "FirstBefore $" + fixture.Latex + "$ FirstAfter\r";
                // 1 = horizontal msoTextOrientation; avoid a separate Office PIA dependency.
                W.Shape box = ((dynamic)document.Shapes).AddTextbox(1, 36f, 100f, 350f, 80f, document.Range(0, 0));
                box.Name = "LaTeXSnipper-Batch-Stories-Test";
                box.TextFrame.TextRange.Text = "BoxBefore $" + fixture.Latex + "$ BoxAfter";

                var scanner = new WordBatchLatexScanner(application);
                var candidates = scanner.Scan();
                Require(candidates.Count == 7, "Expected seven independent story candidates, got " + candidates.Count);
                checks.Add(new { name = "independent-story-scan", count = candidates.Count });
                firstPage.Range.Select();
                var selection = scanner.Scan("selection");
                Require(selection.Count == 1 && selection[0].Locator.Value.GetProperty("sectionIndex").GetInt32() == 2 &&
                    selection[0].Locator.Value.GetProperty("storyType").GetInt32() == (int)W.WdStoryType.wdFirstPageHeaderStory,
                    "Header selection did not retain the section/story locator.");
                box.TextFrame.TextRange.Select();
                selection = scanner.Scan("selection");
                Require(selection.Count == 1 && selection[0].Locator.Value.GetProperty("kind").GetString() == "wordTextFrame",
                    "Text-frame selection did not retain the shape locator.");
                checks.Add(new { name = "selection-story-locators", status = "passed" });
                var selectionSentinel = box.TextFrame.TextRange.Duplicate;
                selectionSentinel.SetRange(selectionSentinel.Start, selectionSentinel.Start + "BoxBefore".Length);
                selectionSentinel.Select();
                Marshal.ReleaseComObject(selectionSentinel);

                var executor = new WordBatchConversionExecutor(application);
                var body = candidates.First(candidate => candidate.Location.StartsWith("Body/", StringComparison.Ordinal));
                var bodyProbe = document.Range(body.Locator.Value.GetProperty("start").GetInt32(),
                    body.Locator.Value.GetProperty("end").GetInt32());
                checks.Add(new { name = "body-locator-probe", expected = body.Source, actual = bodyProbe.Text });
                Require(bodyProbe.Text == body.Source, "Floating shape anchor shifted the body locator.");
                Marshal.ReleaseComObject(bodyProbe);
                string before = document.Content.WordOpenXML;
                var invalid = ToItem(body, fixture);
                invalid.Locator = JsonSerializer.SerializeToElement(new { kind = "unknown", start = 0 });
                var outOfBounds = ToItem(body, fixture);
                outOfBounds.Locator = JsonSerializer.SerializeToElement(new WordRangeLocator
                {
                    StoryType = (int)W.WdStoryType.wdPrimaryHeaderStory, SectionIndex = 99, Start = 0, End = 1
                });
                var changed = ToItem(body, fixture);
                changed.SourceHash = new string('0', 64);
                var guards = executor.Execute("story-guards", new List<BatchConversionItem> { invalid, outOfBounds, changed });
                string afterGuards = document.Content.WordOpenXML;
                checks.Add(new { name = "guard-results", result = guards });
                bool contentsUnchanged = ContentSignature(afterGuards) == ContentSignature(before);
                if (!contentsUnchanged)
                {
                    File.WriteAllText(Path.Combine(directory, "guard-before.xml"), before);
                    File.WriteAllText(Path.Combine(directory, "guard-after.xml"), afterGuards);
                }
                Require(guards.Converted == 0 && guards.Skipped == 3 && contentsUnchanged,
                    "Rejected locators or stale hash mutated the document.");
                checks.Add(new { name = "invalid-locator-and-hash-preserve-document", result = guards });

                var result = executor.Execute("story-acceptance", candidates.Select(candidate => ToItem(candidate, fixture)).ToList());
                checks.Add(new { name = "story-conversion", result });
                checks.Add(new { name = "remaining-after-conversion", candidates = scanner.Scan(), bodyText = document.Content.Text });
                Require(result.Converted == 7 && result.Skipped == 0 && result.Failed == 0,
                    "Expected seven conversions: " + JsonSerializer.Serialize(result));
                Require(application.Selection.StoryType == W.WdStoryType.wdTextFrameStory &&
                    application.Selection.Range.Text == "BoxBefore",
                    "Cross-story conversion moved the unrelated text-frame selection.");
                checks.Add(new { name = "cross-story-selection-preserved", status = "passed" });
                Validate(document);
                string path = Path.Combine(directory, "word-batch-stories.docx");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                Validate(document);
                reopened = true;
            }
            catch (Exception exception)
            {
                error = exception.ToString();
                Console.Error.WriteLine(error);
                try
                {
                    document?.SaveAs2(Path.Combine(directory, "word-batch-stories-failure.docx"),
                        W.WdSaveFormat.wdFormatXMLDocument);
                }
                catch (Exception saveError) { Console.Error.WriteLine(saveError.Message); }
            }
            finally
            {
                File.WriteAllText(Path.Combine(directory, "batch-stories-evidence.json"), JsonSerializer.Serialize(new
                {
                    schemaVersion = 1, host = "word", elapsedMs = watch.ElapsedMilliseconds, checks,
                    saveReopenVerified = reopened, status = error == null ? "passed" : "failed", error,
                    scope = "Native scanner/executor stories and safe rejection; desktop pipe and display layout excluded"
                }, new JsonSerializerOptions { WriteIndented = true }));
            }
            return error == null ? 0 : 1;
        }

        private static BatchConversionItem ToItem(LatexCandidateDto candidate, AcceptanceCase fixture) =>
            new BatchConversionItem
            {
                SourceId = candidate.Id, SourceText = candidate.Source, NormalizedLatex = candidate.NormalizedLatex,
                SourceHash = candidate.SourceHash, Locator = candidate.Locator, Omml = fixture.Omml, Status = "converted"
            };

        private static void Validate(W.Document document)
        {
            var manifest = FormulaDocumentManifest.ReadAll(document);
            Require(manifest.Count == 7 && manifest.Values.All(payload => !string.IsNullOrEmpty(payload.Latex) &&
                !string.IsNullOrEmpty(payload.Omml)), "Persistent formula index did not retain seven source/OMML entries.");
            ValidateRange(document.Content, "BodyBefore", "BodyAfter");
            for (int index = 1; index <= 2; index++)
            {
                ValidateRange(document.Sections[index].Headers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary].Range,
                    "Header" + index + "Before", "Header" + index + "After");
                ValidateRange(document.Sections[index].Footers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary].Range,
                    "Footer" + index + "Before", "Footer" + index + "After");
            }
            ValidateRange(document.Sections[2].Headers[W.WdHeaderFooterIndex.wdHeaderFooterFirstPage].Range,
                "FirstBefore", "FirstAfter");
            ValidateRange(document.Shapes["LaTeXSnipper-Batch-Stories-Test"].TextFrame.TextRange, "BoxBefore", "BoxAfter");
            Require(new WordBatchLatexScanner(document.Application).Scan().Count == 0, "Source delimiters remain after conversion.");
        }

        private static void ValidateRange(W.Range range, string before, string after)
        {
            Require(range.OMaths.Count == 1, before + ": expected exactly one equation.");
            Require(range.Text.Contains(before) && range.Text.Contains(after), before + ": adjacent prose lost.");
            Require(range.ContentControls.Count == 1 && range.ContentControls[1].Tag.StartsWith("latexsnipper:formula:",
                StringComparison.Ordinal), before + ": persistent formula content-control ID lost.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static string ContentSignature(string xml)
        {
            // WordOpenXML regenerates paragraph rsids, drawing IDs and VML
            // binary caches on read. Compare actual text, math and paragraph/run
            // formatting across the exported stories instead of volatile IDs.
            XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            XNamespace m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
            var exported = XDocument.Parse(xml);
            foreach (var attribute in exported.Descendants().Attributes().Where(attribute =>
                attribute.Name.Namespace == w && attribute.Name.LocalName.StartsWith("rsid", StringComparison.Ordinal)).ToList())
                attribute.Remove();
            return string.Join("\n", exported.Descendants().Where(element =>
                element.Name == w + "t" || element.Name == w + "rPr" || element.Name == w + "pPr" ||
                element.Name == m + "oMath").Select(element => element.ToString(SaveOptions.DisableFormatting)));
        }
    }
}
