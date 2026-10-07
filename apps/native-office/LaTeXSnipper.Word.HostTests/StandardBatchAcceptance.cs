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
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class StandardBatchAcceptance
    {
        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        public static int Run(InteropWord.Application app, ref InteropWord.Document doc,
            IReadOnlyList<AcceptanceCase> cases, string input, string directory)
        {
            var results = new List<object>();
            string error = null;
            uint clipboard = GetClipboardSequenceNumber();
            bool previousScreen = app.ScreenUpdating;
            bool? previousLatex = null;
            dynamic commands = ((dynamic)app).CommandBars;
            try
            {
                doc.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(doc);
                doc = null;
                doc = app.Documents.Open(Path.GetFullPath(input), ReadOnly: true, AddToRecentFiles: false);
                doc.ExportAsFixedFormat(Path.Combine(directory, "standard-input.pdf"), InteropWord.WdExportFormat.wdExportFormatPDF);
                // Rotate order to expose, rather than hide, warm-up effects.
                string[][] orders = {
                    new[] { "baseline", "optimized", "word-native" },
                    new[] { "word-native", "baseline", "optimized" },
                    new[] { "optimized", "word-native", "baseline" }
                };
                for (int round = 0; round < orders.Length; round++)
                foreach (string mode in orders[round])
                {
                    doc.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                    Marshal.ReleaseComObject(doc);
                    doc = null;
                    // The authored input is never opened for write or overwritten.
                    string output = Path.Combine(directory, $"standard-{mode}-{round + 1}.docx");
                    File.Copy(Path.GetFullPath(input), output, false);
                    doc = app.Documents.Open(output, ReadOnly: false, AddToRecentFiles: false);
                    var clock = Stopwatch.StartNew();
                    var candidates = new WordBatchLatexScanner(app).Scan();
                    double scanMs = clock.Elapsed.TotalMilliseconds;
                    var expected = cases.Where(item => !item.Unscanned).ToList();
                    if (candidates.Count != expected.Count || candidates.Any(candidate =>
                        !expected.Any(item => item.Source == candidate.Source)))
                        throw new InvalidOperationException("Authored document scan differs from the fixed source contract: " +
                            JsonSerializer.Serialize(candidates.Select(candidate => candidate.Source)));
                    var items = candidates.Select(candidate => {
                        var fixture = expected.First(item => item.Source == candidate.Source);
                        return new BatchConversionItem {
                            SourceId = candidate.Id, SourceText = candidate.Source,
                            NormalizedLatex = candidate.NormalizedLatex, SourceHash = candidate.SourceHash,
                            Locator = candidate.Locator, Omml = fixture.Omml,
                            Status = fixture.Preserve ? "skipped" : "converted",
                            Error = fixture.Preserve ? "Declared unsupported or invalid sample" : null
                        };
                    }).ToList();
                    object execution;
                    app.ScreenUpdating = false;
                    uint clipboardAtExecution = GetClipboardSequenceNumber();
                    clock.Restart();
                    if (mode == "word-native")
                    {
                        var nativeTimes = new List<object>();
                        foreach (var item in items.Where(item => item.Status == "converted")
                            .OrderByDescending(item => item.Locator.Value.GetProperty("start").GetInt32()))
                        {
                            var timer = Stopwatch.StartNew();
                            int start = item.Locator.Value.GetProperty("start").GetInt32();
                            int end = item.Locator.Value.GetProperty("end").GetInt32();
                            InteropWord.Range range = doc.Range(start, end);
                            InteropWord.Range equation = null;
                            try
                            {
                                if (range.Text != item.SourceText) throw new InvalidOperationException("Native source shifted.");
                                range.Text = item.NormalizedLatex;
                                range.SetRange(start, start + item.NormalizedLatex.Length);
                                equation = range.OMaths.Add(range);
                                equation.Select();
                                bool latex = commands.GetPressedMso("EquationLaTexFormat");
                                if (!previousLatex.HasValue) previousLatex = latex;
                                if (!latex) commands.ExecuteMso("EquationLaTexFormat");
                                commands.ExecuteMso("EquationProfessionalOne");
                                nativeTimes.Add(new { source = item.SourceText, elapsedMs = timer.Elapsed.TotalMilliseconds });
                            }
                            finally
                            {
                                if (equation != null) Marshal.ReleaseComObject(equation);
                                Marshal.ReleaseComObject(range);
                            }
                        }
                        execution = new { nativeTimes };
                    }
                    else
                    {
                        var executor = new WordBatchConversionExecutor(app, reuseInlineScratch: mode == "optimized");
                        var result = executor.Execute("standard", items);
                        if (app.ScreenUpdating) throw new InvalidOperationException("Executor changed the caller's screen state.");
                        execution = new { result, stages = executor.StageTimings };
                    }
                    double executeMs = clock.Elapsed.TotalMilliseconds;
                    bool executionClipboardUnchanged = GetClipboardSequenceNumber() == clipboardAtExecution;
                    app.ScreenUpdating = previousScreen;
                    clock.Restart();
                    var validation = Validate(doc, cases, mode != "word-native");
                    double validationMs = clock.Elapsed.TotalMilliseconds;
                    doc.Save();
                    doc.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                    Marshal.ReleaseComObject(doc);
                    doc = null;
                    doc = app.Documents.Open(output, ReadOnly: true, AddToRecentFiles: false);
                    var reopened = Validate(doc, cases, mode != "word-native");
                    if (JsonSerializer.Serialize(validation) != JsonSerializer.Serialize(reopened))
                        throw new InvalidOperationException("Standard sample changed after save/reopen.");
                    if (round == 0)
                        doc.ExportAsFixedFormat(Path.ChangeExtension(output, ".pdf"), InteropWord.WdExportFormat.wdExportFormatPDF);
                    results.Add(new { round = round + 1, mode, scanMs, executeMs, validationMs,
                        execution, validation, executionClipboardUnchanged, saveReopenStable = true });
                    Console.WriteLine($"standard {round + 1} {mode} {executeMs:F1} ms");
                }
            }
            catch (Exception exception)
            {
                error = exception.ToString(); Console.Error.WriteLine(error);
                if (doc != null)
                    doc.SaveAs2(Path.Combine(directory, "standard-failure.docx"), InteropWord.WdSaveFormat.wdFormatXMLDocument);
            }
            finally
            {
                app.ScreenUpdating = previousScreen;
                // Input mode can be a global Word preference. Restore the captured value.
                if (previousLatex.HasValue && doc != null && doc.OMaths.Count > 0)
                {
                    doc.OMaths[1].Range.Select();
                    if (commands.GetPressedMso("EquationLaTexFormat") != previousLatex.Value)
                        commands.ExecuteMso(previousLatex.Value ? "EquationLaTexFormat" : "EquationUnicodeMathFormat");
                }
                Marshal.ReleaseComObject(commands);
                File.WriteAllText(Path.Combine(directory, "standard-evidence.json"), JsonSerializer.Serialize(new {
                    schemaVersion = 1, wordVersion = app.Version, wordBuild = app.Build,
                    results, error, status = error == null ? "completed" : "failed",
                    clipboardUnchanged = GetClipboardSequenceNumber() == clipboard,
                    scope = "Same authored DOCX and 12 prepared formulas. Timings exclude Core conversion, save/reopen and post-validation. Native Word has no app metadata/rollback. Structural checks are not a mathematical equivalence proof."
                }, new JsonSerializerOptions { WriteIndented = true }));
            }
            return error == null ? 0 : 1;
        }

        private static List<object> Validate(InteropWord.Document doc, IReadOnlyList<AcceptanceCase> cases, bool metadata)
        {
            XNamespace m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
            XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            var xml = XDocument.Parse(doc.Content.WordOpenXML);
            var paragraphs = xml.Descendants(w + "body").Single().Descendants(w + "p").ToList();
            var manifest = FormulaDocumentManifest.ReadAll(doc);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var checks = new List<object>();
            foreach (var item in cases)
            {
                var matches = paragraphs.Where(paragraph => string.Concat(paragraph.Descendants(w + "t").Select(t => t.Value))
                    .StartsWith(item.Name + " 正文前 ", StringComparison.Ordinal)).ToList();
                if (matches.Count != 1) throw new InvalidOperationException("Missing or duplicate paragraph " + item.Name + ": " +
                    string.Join(" | ", paragraphs.Select(p0 => string.Concat(p0.Descendants(w + "t").Select(t => t.Value)))));
                var p = matches[0];
                string prose = string.Concat(p.Descendants(w + "t").Select(t => t.Value));
                if (!prose.EndsWith(" 正文后 " + item.Name, StringComparison.Ordinal))
                    throw new InvalidOperationException("Adjacent prose changed: " + item.Name);
                if (item.Preserve)
                {
                    if (!prose.Contains(item.Source) || p.Descendants(m + "oMath").Any())
                        throw new InvalidOperationException("Protected sample changed: " + item.Name);
                    checks.Add(new { name = item.Name, status = "preserved" });
                    continue;
                }
                string text = string.Concat(p.Descendants(m + "t").Select(t => t.Value));
                bool structure = p.Descendants(m + "oMath").Count() == 1 && !text.Contains("\\") &&
                    item.RequiredTags.All(tag => p.Descendants(m + tag).Any()) && item.Probes.All(text.Contains) &&
                    (item.AlternativeTags == null || item.AlternativeTags.Any(tags => tags.All(tag => p.Descendants(m + tag).Any())));
                bool sourceMetadata = !metadata;
                if (metadata)
                {
                    string tag = (string)p.Descendants(w + "tag").SingleOrDefault()?.Attribute(w + "val");
                    string id = tag?.StartsWith("latexsnipper:formula:", StringComparison.Ordinal) == true
                        ? tag.Substring("latexsnipper:formula:".Length) : null;
                    sourceMetadata = id != null && ids.Add(id) && manifest.TryGetValue(id, out var payload) &&
                        payload.Latex == item.Latex && payload.Omml == item.Omml &&
                        LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidator.ValidateHostReadBack(item.Omml, p.ToString()).IsValid;
                }
                if (metadata && (!structure || !sourceMetadata))
                    throw new InvalidOperationException("App sample did not preserve formula structure and identity: " + item.Name);
                checks.Add(new { name = item.Name, status = structure && sourceMetadata ? "structure-passed" : "review-required",
                    structure, sourceMetadata, mathText = text });
            }
            if (metadata && (manifest.Count != cases.Count(item => !item.Preserve) ||
                doc.ContentControls.Count != manifest.Count))
                throw new InvalidOperationException("Missing formula metadata or retained scratch object.");
            return checks;
        }
    }
}
