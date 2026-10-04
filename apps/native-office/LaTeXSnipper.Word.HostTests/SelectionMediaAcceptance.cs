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
    internal static class SelectionMediaAcceptance
    {
        internal static int Run(W.Application application, ref W.Document document, WordAdapter adapter,
            AcceptanceCase fixture, RenderData render, string directory, int? wordPid)
        {
            var watch = Stopwatch.StartNew();
            var checks = new List<object>();
            var identities = new Dictionary<string, string>();
            string error = null;
            try
            {
                foreach (string format in new[] { "svg", "png", "ole" })
                {
                    int start = document.Content.End - 1;
                    document.Range(start, start).InsertAfter("prefix " + fixture.Latex + " suffix duplicate " + fixture.Latex + "\r");
                    var selected = document.Range(start + 7, start + 7 + fixture.Latex.Length);
                    selected.Select();
                    var candidate = new WordBatchLatexScanner(application).Scan("selection-latex").Single();
                    var item = new BatchConversionItem {
                        SourceId = candidate.Id, SourceText = candidate.Source, NormalizedLatex = candidate.NormalizedLatex,
                        Omml = fixture.Omml, Locator = candidate.Locator, SourceHash = candidate.SourceHash, Status = "converted",
                    };
                    var payload = new FormulaPayload {
                        FormulaId = FormulaIdHelper.NewId(), Latex = item.NormalizedLatex, Omml = item.Omml,
                        Display = "inline", StorageMode = format == "ole" ? "ole" : "image",
                        Render = new RenderData { Svg = format == "png" ? null : render.Svg,
                            Png = format == "svg" ? null : render.Png, WidthPt = render.WidthPt, HeightPt = render.HeightPt },
                    };
                    var executor = new WordBatchConversionExecutor(application, wordPid);
                    string before = document.Content.Text;
                    var stale = Clone(item); stale.SourceHash = new string('0', 64);
                    var rejected = executor.ExecuteSelectionMedia("stale", stale, payload, format);
                    Require(rejected.Converted == 0 && document.Content.Text == before &&
                        adapter.ReadFormulaById(payload.FormulaId) == null, "Stale source mutated the document.");
                    var invalid = Clone(payload); invalid.Render.WidthPt = 0;
                    rejected = executor.ExecuteSelectionMedia("invalid-size", item, invalid, format);
                    Require(rejected.Converted == 0 && document.Content.Text == before, "Invalid geometry mutated the source.");
                    if (format == "png")
                    {
                        var broken = Clone(payload); broken.Render.Png = Convert.ToBase64String(new byte[] { 1, 2, 3 });
                        rejected = executor.ExecuteSelectionMedia("invalid-png", item, broken, format);
                        Require(rejected.Converted == 0 && document.Content.Text == before &&
                            adapter.ReadFormulaById(payload.FormulaId) == null, "Invalid PNG did not roll back.");
                    }
                    var result = executor.ExecuteSelectionMedia("media-" + format, item, payload, format);
                    Require(result.Converted == 1 && result.Failed == 0 && result.Skipped == 0,
                        "Media replacement failed: " + JsonSerializer.Serialize(result));
                    identities.Add(format, payload.FormulaId);
                    adapter.ValidateSelectionMediaCandidate(document, payload, format, W.WdStoryType.wdMainTextStory, start);
                    string paragraph = document.Range(start, document.Content.End - 1).Text;
                    Require(paragraph.Contains("prefix ") && paragraph.Contains(" suffix duplicate " + fixture.Latex) &&
                        paragraph.Split(new[] { fixture.Latex }, StringSplitOptions.None).Length == 2,
                        "Wrong occurrence or surrounding text was replaced.");
                    var insertedControl = document.ContentControls.Cast<W.ContentControl>().Single(c => c.Tag == "latexsnipper:formula:" + payload.FormulaId);
                    var insertedShape = insertedControl.Range.InlineShapes[1];
                    checks.Add(new { format, sourcePreservedOnFailure = true, exactOccurrence = true, realObjectReadback = true,
                        requestedWidthPt = render.WidthPt, requestedHeightPt = render.HeightPt,
                        actualWidthPt = insertedShape.Width, actualHeightPt = insertedShape.Height });
                    Marshal.ReleaseComObject(insertedShape); Marshal.ReleaseComObject(insertedControl);
                }
                string path = Path.Combine(directory, "selection-media.docx");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdSaveChanges); Marshal.ReleaseComObject(document); document = null;
                GC.Collect(); GC.WaitForPendingFinalizers();
                document = application.Documents.Open(FileName: path, ReadOnly: false, AddToRecentFiles: false, Visible: true);
                foreach (var entry in identities)
                {
                    var stored = FormulaDocumentManifest.Read(document, entry.Value);
                    Require(stored != null && stored.Latex == fixture.Latex, "Source was lost after save/reopen.");
                    adapter.ValidateSelectionMediaCandidate(document, stored, entry.Key, W.WdStoryType.wdMainTextStory, 0);
                    var control = document.ContentControls.Cast<W.ContentControl>().Single(c => c.Tag == "latexsnipper:formula:" + entry.Value);
                    control.Range.Select();
                    Require(adapter.ReadSelection()?.FormulaId == entry.Value, "Selection readback lost formula identity.");
                    checks.Add(new { format = entry.Key, saveReopen = true, selectionReadback = true });
                }
                document.ExportAsFixedFormat(Path.Combine(directory, "selection-media-visual.pdf"), W.WdExportFormat.wdExportFormatPDF);
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            watch.Stop();
            File.WriteAllText(Path.Combine(directory, "selection-media-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, host = "word", status = error == null ? "passed" : "failed", pipeVerified = false,
                fixture = fixture.Name, seconds = watch.Elapsed.TotalSeconds, checks, error,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine("Selection media " + (error == null ? "passed" : "failed"));
            return error == null ? 0 : 1;
        }
        private static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value));
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    }
}
