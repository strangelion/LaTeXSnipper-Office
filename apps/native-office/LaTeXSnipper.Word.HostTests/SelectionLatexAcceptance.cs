using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class SelectionLatexAcceptance
    {
        internal static int Run(W.Application application, ref W.Document document, AcceptanceCase fixture, string directory)
        {
            var watch = Stopwatch.StartNew();
            var checks = new List<object>();
            string error = null;
            bool reopened = false;
            try
            {
                var scanner = new WordBatchLatexScanner(application);
                foreach (string raw in new[] { @"\frac{a}{b}", "x^2+y_1=0", @"\begin{matrix}a&b\\c&d\end{matrix}", "a^2\r+b^2" })
                {
                    document.Content.Text = "Before " + raw + " After\r";
                    var selected = document.Range(7, 7 + raw.Length);
                    selected.Font.Bold = 1;
                    int originalBold = selected.Font.Bold;
                    string originalText = document.Content.Text;
                    selected.Select();
                    var candidates = scanner.Scan("selection-latex");
                    checks.Add(new { name = "raw-scan-probe", source = raw, selectedText = application.Selection.Range.Text, candidates });
                    Require(candidates.Count == 1 && candidates[0].Source == raw && candidates[0].NormalizedLatex == raw,
                        "Raw selection lost source: " + raw);
                    Require(document.Content.Text == originalText && selected.Font.Bold == originalBold,
                        "Scan mutated source/formatting.");
                    Require(scanner.Scan().Count == 0, "Default scan guessed raw formula.");
                }
                checks.Add(new { name = "raw-fraction-script-environment-multiline-read-only-scan", status = "passed" });
                foreach (string raw in new[] { "plain prose", @"C:\Users\x^2", "$x^2", @"\frac{a}{b", "x^2\\" })
                {
                    document.Content.Text = raw + "\r";
                    document.Content.Select();
                    string rejectedBefore = document.Content.Text;
                    bool rejected = false;
                    try { scanner.Scan("selection-latex"); } catch (FormatException) { rejected = true; }
                    Require(rejected && document.Content.Text == rejectedBefore, "Invalid selection accepted or mutated.");
                }
                checks.Add(new { name = "plain-prose-path-delimiter-brace-command-rejection", status = "passed" });

                document.Content.Text = "Before " + fixture.Latex + " After " + fixture.Latex + " End\r";
                var bodyRange = document.Range(7, 7 + fixture.Latex.Length);
                bodyRange.Font.Bold = 1;
                int bodyBold = bodyRange.Font.Bold;
                bodyRange.Select();
                var body = scanner.Scan("selection-latex").Single();
                var executor = new WordBatchConversionExecutor(application);
                var failed = Item(body, fixture);
                failed.Status = "failed"; failed.Omml = null; failed.Error = "Injected converter rejection";
                var rejectedResult = executor.Execute("selection-rejected", new List<BatchConversionItem> { failed });
                Require(rejectedResult.Converted == 0 && rejectedResult.Skipped == 1 && bodyRange.Text == fixture.Latex && bodyRange.Font.Bold == bodyBold,
                    "Failed conversion did not retain text/formatting.");
                // A second identical formula must not be selected as fallback.
                string changed = new string('q', fixture.Latex.Length);
                bodyRange.Text = changed;
                var stale = executor.Execute("selection-stale", new List<BatchConversionItem> { Item(body, fixture) });
                Require(stale.Converted == 0 && stale.Skipped == 1 && document.Content.Text.Contains(" After " + fixture.Latex + " End"),
                    "Stale selection retargeted duplicate source.");
                bodyRange.Text = fixture.Latex;
                bodyRange.Select();
                body = scanner.Scan("selection-latex").Single();
                checks.Add(new { name = "failed-conversion-and-stale-duplicate-preserve-original", status = "passed" });

                var header = document.Sections[1].Headers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary];
                header.Range.Text = "Header " + fixture.Latex + " Tail\r";
                var headerRange = header.Range.Duplicate;
                headerRange.SetRange(headerRange.Start + 7, headerRange.Start + 7 + fixture.Latex.Length);
                headerRange.Select();
                var headerCandidate = scanner.Scan("selection-latex").Single();
                Require(headerCandidate.Locator.Value.GetProperty("sectionIndex").GetInt32() == 1,
                    "Raw header selection lost its section.");
                W.Shape box = ((dynamic)document.Shapes).AddTextbox(1, 36f, 100f, 350f, 80f, document.Range(0, 0));
                box.Name = "LaTeXSnipper-Raw-Selection-Test";
                box.TextFrame.TextRange.Text = "Box " + fixture.Latex + " Tail";
                var boxRange = box.TextFrame.TextRange.Duplicate;
                boxRange.SetRange(boxRange.Start + 4, boxRange.Start + 4 + fixture.Latex.Length);
                boxRange.Select();
                var boxCandidate = scanner.Scan("selection-latex").Single();
                Require(boxCandidate.Locator.Value.GetProperty("kind").GetString() == "wordTextFrame", "Raw box selection lost shape identity.");
                // Adding the floating box may shift body positions; capture body anew.
                bodyRange.Select();
                body = scanner.Scan("selection-latex").Single();
                var result = executor.Execute("selection-three-stories", new List<BatchConversionItem> {
                    Item(body, fixture), Item(headerCandidate, fixture), Item(boxCandidate, fixture) });
                Require(result.Converted == 3 && result.Failed == 0 && result.Skipped == 0, "Raw source story insertion failed: " + JsonSerializer.Serialize(result));
                Require(document.Content.Text.Contains("Before ") && document.Content.Text.Contains(" After " + fixture.Latex + " End"),
                    "Adjacent prose or unselected duplicate was changed.");
                checks.Add(new { name = "body-header-text-frame-conversion", result });
                Validate(document);
                // A format target must create the promised object, not relabel it.
                var adapter = new WordAdapter(application);
                string bodyId = document.ContentControls[1].Tag.Substring("latexsnipper:formula:".Length);
                string conversionBefore = document.Content.Text;
                var unsupported = adapter.ConvertFormula(bodyId, "image");
                Require(!unsupported.Success && unsupported.ErrorCode == "UNSUPPORTED_CONVERSION_TARGET" && document.Content.Text == conversionBefore,
                    "Unsupported conversion target changed the document.");
                var stored = FormulaDocumentManifest.Read(document, bodyId);
                Require(stored != null, "Body manifest not found for conversion guard test.");
                string storedOmml = stored.Omml;
                try
                {
                    stored.Omml = "";
                    FormulaDocumentManifest.Write(document, stored);
                    var missing = adapter.ConvertFormula(bodyId, "native");
                    Require(!missing.Success && missing.ErrorCode == "OMML_CONVERSION_DATA_MISSING" && document.Content.Text == conversionBefore &&
                        FormulaDocumentManifest.Read(document, bodyId).Omml == "",
                        "Missing OMML was incorrectly reported as converted.");
                }
                finally
                {
                    stored.Omml = storedOmml;
                    FormulaDocumentManifest.Write(document, stored);
                }
                checks.Add(new { name = "storage-conversion-target-and-missing-omml-guards", status = "passed" });
                string path = Path.Combine(directory, "word-selection-latex.docx");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                Validate(document);
                reopened = true;
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            finally
            {
                File.WriteAllText(Path.Combine(directory, "selection-latex-evidence.json"), JsonSerializer.Serialize(new {
                    schemaVersion = 1, host = "word", elapsedMs = watch.ElapsedMilliseconds, checks,
                    status = error == null ? "passed" : "failed", error, saveReopenVerified = reopened,
                    scope = "Native raw selection scanner/executor, rejection and source persistence; desktop pipe and Office.js host excluded"
                }, new JsonSerializerOptions { WriteIndented = true }));
            }
            return error == null ? 0 : 1;
        }

        private static BatchConversionItem Item(LatexCandidateDto candidate, AcceptanceCase fixture) => new BatchConversionItem {
            SourceId = candidate.Id, SourceText = candidate.Source, NormalizedLatex = candidate.NormalizedLatex,
            SourceHash = candidate.SourceHash, Locator = candidate.Locator, Omml = fixture.Omml, Status = "converted"
        };
        private static void Validate(W.Document document)
        {
            var entries = FormulaDocumentManifest.ReadAll(document);
            Require(entries.Count == 3 && entries.Values.All(entry => !string.IsNullOrEmpty(entry.Latex) && !string.IsNullOrEmpty(entry.Omml)),
                "Three persistent source/OMML entries were not retained.");
            Require(document.Content.OMaths.Count == 1 && document.Sections[1].Headers[W.WdHeaderFooterIndex.wdHeaderFooterPrimary].Range.OMaths.Count == 1 &&
                document.Shapes["LaTeXSnipper-Raw-Selection-Test"].TextFrame.TextRange.OMaths.Count == 1, "Raw source OMath lost after save/reopen.");
        }
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    }
}
