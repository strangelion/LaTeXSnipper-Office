using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class BatchAcceptance
    {
        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        public static int Run(InteropWord.Application application, ref InteropWord.Document document,
            AcceptanceCase fixture, string directory, int count = 250, bool reuseInlineScratch = true)
        {
            var chunks = new List<object>();
            int converted = 0, skipped = 0, failed = 0;
            string error = null;
            bool reopened = false;
            bool metadataVerified = false;
            uint clipboardBefore = GetClipboardSequenceNumber();
            var watch = Stopwatch.StartNew();
            long scanMs = 0, validationMs = 0, saveMs = 0, reopenMs = 0;
            try
            {
                // Unique paragraph markers detect accidental replacement of adjacent prose.
                var source = new StringBuilder();
                string[] wrappers = { "$", "$$", "\\(", "\\[" };
                for (int i = 0; i < count; i++)
                {
                    string open = wrappers[i % wrappers.Length];
                    string close = open == "\\(" ? "\\)" : open == "\\[" ? "\\]" : open;
                    source.Append($"Before{i:D4} {open}{fixture.Latex}{close} After{i:D4}\r");
                }
                document.Content.Text = source.ToString();
                var stageWatch = Stopwatch.StartNew();
                var candidates = new WordBatchLatexScanner(application).Scan();
                scanMs = stageWatch.ElapsedMilliseconds;
                if (candidates.Count != count)
                    throw new InvalidOperationException($"Scan expected {count}, got {candidates.Count}.");
                var items = candidates.Select(candidate => new BatchConversionItem
                {
                    SourceId = candidate.Id, SourceText = candidate.Source,
                    NormalizedLatex = candidate.NormalizedLatex,
                    SourceHash = candidate.SourceHash, Locator = candidate.Locator,
                    Omml = fixture.Omml, Status = "converted"
                }).OrderByDescending(item => item.Locator.Value.GetProperty("start").GetInt32()).ToList();
                // One bad payload in a later chunk must leave its source intact;
                // successful earlier and later chunks must remain usable.
                items[count / 2].Omml = "<invalid/>";
                var executor = new WordBatchConversionExecutor(application, reuseInlineScratch: reuseInlineScratch);
                for (int offset = 0; offset < count; offset += 25)
                {
                    var chunkWatch = Stopwatch.StartNew();
                    var result = executor.Execute("acceptance-" + offset,
                        items.Skip(offset).Take(25).ToList());
                    converted += result.Converted;
                    skipped += result.Skipped;
                    failed += result.Failed;
                    var stages = executor.StageTimings;
                    chunks.Add(new { offset, elapsedMs = chunkWatch.ElapsedMilliseconds,
                        stages, result });
                    ValidateStageTimings(stages, Math.Min(25, count - offset), result.Converted, reuseInlineScratch);
                    Console.WriteLine($"batch offset={offset} converted={result.Converted} " +
                        $"skipped={result.Skipped} failed={result.Failed}");
                }
                if (converted != count - 1 || skipped != 1 || failed != 0)
                    throw new InvalidOperationException(
                        $"Expected {count - 1}/1/0 converted/skipped/failed, got {converted}/{skipped}/{failed}.");
                stageWatch.Restart();
                var originalManifest = ValidateDocument(document, count, fixture);
                validationMs = stageWatch.ElapsedMilliseconds;
                if (GetClipboardSequenceNumber() != clipboardBefore)
                    throw new InvalidOperationException("Native batch conversion changed the clipboard.");
                string path = Path.Combine(directory, "word-batch-acceptance.docx");
                stageWatch.Restart();
                document.SaveAs2(path, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                saveMs = stageWatch.ElapsedMilliseconds;
                document.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                stageWatch.Restart();
                document = application.Documents.Open(path, ReadOnly: true,
                    AddToRecentFiles: false, Visible: true);
                var reopenedManifest = ValidateDocument(document, count, fixture);
                if (!originalManifest.OrderBy(entry => entry.Key, StringComparer.Ordinal)
                    .SequenceEqual(reopenedManifest.OrderBy(entry => entry.Key, StringComparer.Ordinal)))
                    throw new InvalidOperationException("Formula IDs or full payloads changed after save/reopen.");
                metadataVerified = true;
                reopenMs = stageWatch.ElapsedMilliseconds;
                reopened = true;
            }
            catch (Exception exception)
            {
                error = exception.ToString();
                Console.Error.WriteLine(error);
                try
                {
                    if (document != null)
                        document.SaveAs2(Path.Combine(directory, "word-batch-failure.docx"),
                            InteropWord.WdSaveFormat.wdFormatXMLDocument);
                }
                catch (Exception saveError)
                {
                    Console.Error.WriteLine("Failure artifact unavailable: " + saveError.Message);
                }
            }
            finally
            {
                File.WriteAllText(Path.Combine(directory, "batch-evidence.json"),
                    JsonSerializer.Serialize(new
                    {
                        schemaVersion = 1, host = "word", requested = count, reuseInlineScratch,
                        converted, skipped, failed, elapsedMs = watch.ElapsedMilliseconds,
                        stages = new { scanMs, validationMs, saveMs, reopenMs },
                        timingScope = "Serial inclusive timings; nested stages overlap and must not be summed. Core conversion, pipe transport and field refresh are not measured.",
                        clipboardUnchanged = GetClipboardSequenceNumber() == clipboardBefore,
                        saveReopenVerified = reopened, metadataSaveReopenVerified = metadataVerified, chunks, error,
                        status = error == null ? "passed" : "failed",
                        scope = "Native scanner/executor; pipe timeout and clipboard paste excluded"
                    }, new JsonSerializerOptions { WriteIndented = true }));
            }
            return error == null ? 0 : 1;
        }

        private static Dictionary<string, string> ValidateDocument(InteropWord.Document document, int count,
            AcceptanceCase fixture)
        {
            if (document.OMaths.Count != count - 1)
                throw new InvalidOperationException($"Expected {count - 1} equations, got {document.OMaths.Count}.");
            string text = document.Content.Text;
            for (int i = 0; i < count; i++)
                if (!text.Contains($"Before{i:D4}") || !text.Contains($"After{i:D4}"))
                    throw new InvalidOperationException($"Adjacent prose lost at item {i}.");
            var remaining = new WordBatchLatexScanner(document.Application).Scan();
            if (remaining.Count != 1)
                throw new InvalidOperationException($"Expected one preserved source, got {remaining.Count}.");
            var manifest = FormulaDocumentManifest.ReadAll(document);
            if (manifest.Count != count - 1 || manifest.Any(entry =>
                entry.Key != entry.Value.FormulaId || entry.Value.Latex != fixture.Latex ||
                entry.Value.Omml != fixture.Omml || entry.Value.StorageMode != "native-omml" ||
                entry.Value.Display != "inline"))
                throw new InvalidOperationException("Persistent formula index lost source, OMML or storage metadata.");
            var controlIds = new HashSet<string>(StringComparer.Ordinal);
            if (document.ContentControls.Count != count - 1)
                throw new InvalidOperationException("Formula content-control count differs from the manifest.");
            for (int index = 1; index <= document.ContentControls.Count; index++)
            {
                var control = document.ContentControls[index];
                try
                {
                    const string prefix = "latexsnipper:formula:";
                    string tag = control.Tag;
                    if (!tag.StartsWith(prefix, StringComparison.Ordinal) ||
                        !controlIds.Add(tag.Substring(prefix.Length)) ||
                        !manifest.ContainsKey(tag.Substring(prefix.Length)))
                        throw new InvalidOperationException("Formula control has an absent or duplicate persistent ID.");
                }
                finally { Marshal.ReleaseComObject(control); }
            }
            return manifest.ToDictionary(entry => entry.Key, entry => JsonSerializer.Serialize(entry.Value));
        }

        public static int RunScratchSafety(InteropWord.Application application, ref InteropWord.Document document,
            IReadOnlyList<AcceptanceCase> fixtures, string directory)
        {
            var checks = new List<object>();
            string error = null;
            uint clipboardBefore = GetClipboardSequenceNumber();
            try
            {
                var first = fixtures.First();
                var second = fixtures.First(item => item.Latex != first.Latex && item.Omml != first.Omml);
                var sequence = new[] { first, first, second, second, first, first };
                document.Content.Text = string.Concat(sequence.Select((item, index) =>
                    $"Before{index} ${item.Latex}$ After{index}\r"));
                var executor = new WordBatchConversionExecutor(application);
                var candidates = new WordBatchLatexScanner(application).Scan();
                var items = candidates.Select(candidate => new BatchConversionItem
                {
                    SourceId = candidate.Id, SourceText = candidate.Source, NormalizedLatex = candidate.NormalizedLatex,
                    SourceHash = candidate.SourceHash, Locator = candidate.Locator, Status = "converted",
                    Omml = candidate.NormalizedLatex == first.Latex ? first.Omml : second.Omml
                }).ToList();
                var result = executor.Execute("scratch-mixed", items);
                if (result.Converted != 6 || result.Skipped != 0 || result.Failed != 0 ||
                    executor.StageTimings["scratch-insert-xml"].Calls != 3 ||
                    executor.StageTimings["scratch-template-reuse"].Calls != 3)
                    throw new InvalidOperationException("Mixed template switching or exact reuse failed.");
                checks.Add(new { name = "mixed-a-a-b-b-a-a", result, stages = executor.StageTimings });
                ValidateMixedScratchDocument(document, sequence);
                string path = Path.Combine(directory, "word-batch-scratch.docx");
                document.SaveAs2(path, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                document.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                ValidateMixedScratchDocument(document, sequence);
                document.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Add();
                document.Content.Text = "FreshBefore $" + first.Latex + "$ FreshAfter\r";
                var fresh = new WordBatchLatexScanner(application).Scan().Single();
                result = executor.Execute("scratch-new-document", new List<BatchConversionItem> { new BatchConversionItem
                {
                    SourceId = fresh.Id, SourceText = fresh.Source, NormalizedLatex = fresh.NormalizedLatex,
                    SourceHash = fresh.SourceHash, Locator = fresh.Locator, Omml = first.Omml, Status = "converted"
                } });
                if (result.Converted != 1 || result.Skipped != 0 || result.Failed != 0 ||
                    executor.StageTimings["scratch-insert-xml"].Calls != 1 ||
                    executor.StageTimings.ContainsKey("scratch-template-reuse") || document.ContentControls.Count != 1)
                    throw new InvalidOperationException("Scratch state leaked across Execute or documents.");
                if (GetClipboardSequenceNumber() != clipboardBefore)
                    throw new InvalidOperationException("Scratch reuse changed the clipboard.");
                checks.Add(new { name = "fresh-document-and-batch", result, stages = executor.StageTimings });
                ValidateScratchCleanupGuard(document);
                checks.Add(new { name = "cleanup-preserves-new-paragraph-content", status = "passed" });
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "scratch-evidence.json"), JsonSerializer.Serialize(new
            {
                schemaVersion = 1, checks, status = error == null ? "passed" : "failed", error,
                scope = "Mixed exact templates, independent target metadata, save/reopen and batch/document isolation"
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }

        private static void ValidateScratchCleanupGuard(InteropWord.Document document)
        {
            document.Content.InsertParagraphAfter();
            var scratch = document.Range(document.Content.End - 1, document.Content.End - 1);
            int start = scratch.Start;
            scratch.Text = "template protected-tail";
            var controlRange = document.Range(start, start + "template".Length);
            var control = document.ContentControls.Add(InteropWord.WdContentControlType.wdContentControlRichText, controlRange);
            var paragraph = scratch.Paragraphs[1].Range.Duplicate;
            var cache = new WordAdapter.InlineScratchSession();
            try
            {
                cache.Retain(document, "guard-probe", controlRange, control, paragraph);
                control = null;
                paragraph = null;
                bool refused = false;
                try { cache.Dispose(); }
                catch (InvalidOperationException exception) { refused = exception.Message == "BATCH_SCRATCH_CLEANUP_NOT_EMPTY"; }
                if (!refused || !document.Content.Text.Contains("protected-tail") ||
                    !document.Content.Text.Contains("FreshBefore") || !document.Content.Text.Contains("FreshAfter"))
                    throw new InvalidOperationException("Scratch cleanup deleted non-template content.");
            }
            finally
            {
                cache.Dispose();
                if (control != null) Marshal.ReleaseComObject(control);
                if (paragraph != null) Marshal.ReleaseComObject(paragraph);
                Marshal.ReleaseComObject(controlRange);
                Marshal.ReleaseComObject(scratch);
            }
        }

        private static void ValidateMixedScratchDocument(InteropWord.Document document, AcceptanceCase[] expected)
        {
            var manifest = FormulaDocumentManifest.ReadAll(document);
            if (document.OMaths.Count != expected.Length || document.ContentControls.Count != expected.Length ||
                manifest.Count != expected.Length || new WordBatchLatexScanner(document.Application).Scan().Count != 0)
                throw new InvalidOperationException("Scratch artifacts or missing mixed formulas.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < expected.Length; index++)
            {
                var paragraph = document.Paragraphs[index + 1].Range;
                InteropWord.ContentControl control = null;
                try
                {
                    if (!paragraph.Text.StartsWith($"Before{index} ", StringComparison.Ordinal) ||
                        !paragraph.Text.EndsWith($" After{index}\r", StringComparison.Ordinal) || paragraph.ContentControls.Count != 1)
                        throw new InvalidOperationException("Mixed candidate moved or changed adjacent text.");
                    control = paragraph.ContentControls[1];
                    string id = control.Tag.Substring("latexsnipper:formula:".Length);
                    if (!ids.Add(id) || !manifest.TryGetValue(id, out var payload) ||
                        payload.Latex != expected[index].Latex || payload.Omml != expected[index].Omml ||
                        !LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidator.ValidateHostReadBack(expected[index].Omml, control.Range.WordOpenXML).IsValid)
                        throw new InvalidOperationException("Template reuse mixed formula identity or semantics.");
                }
                finally
                {
                    if (control != null) Marshal.ReleaseComObject(control);
                    Marshal.ReleaseComObject(paragraph);
                }
            }
        }

        private static void ValidateStageTimings(Dictionary<string, BatchStageMeasurement> stages,
            int attempted, int converted, bool reuseInlineScratch)
        {
            string[] committedStages = { "insert-total", "scratch-materialize-and-copy", "readback-validation",
                "presentation-style", "manifest-write", "delete-original", "scratch-copy-math" };
            foreach (string stage in committedStages.Concat(new[] { "candidate-total", "validate-omml-and-source" }))
            {
                int minimum = stage == "candidate-total" || stage == "validate-omml-and-source"
                    ? attempted : converted;
                int maximum = stage == "manifest-write" || stage == "delete-original" ? converted : attempted;
                if (!stages.TryGetValue(stage, out var measurement) ||
                    measurement.Calls < minimum || measurement.Calls > maximum ||
                    double.IsNaN(measurement.ElapsedMs) || double.IsInfinity(measurement.ElapsedMs) ||
                    measurement.ElapsedMs < 0)
                    throw new InvalidOperationException($"Invalid measurement for {stage}; expected {minimum}..{maximum} calls.");
            }
            if (stages["candidate-total"].ElapsedMs < stages["insert-total"].ElapsedMs ||
                stages["insert-total"].ElapsedMs < stages["scratch-materialize-and-copy"].ElapsedMs)
                throw new InvalidOperationException("Nested timings are not inclusive.");
            foreach (string stage in new[] { "scratch-insert-xml", "scratch-find-control" })
            {
                int expected = reuseInlineScratch ? 1 : converted;
                if (!stages.TryGetValue(stage, out var measurement) || measurement.Calls != expected ||
                    double.IsNaN(measurement.ElapsedMs) || double.IsInfinity(measurement.ElapsedMs) || measurement.ElapsedMs < 0)
                    throw new InvalidOperationException($"Expected {expected} template materializations for {stage}.");
            }
            if (reuseInlineScratch && (!stages.TryGetValue("scratch-template-reuse", out var reuse) || reuse.Calls != converted - 1))
                throw new InvalidOperationException("Exact repeated templates did not reuse their batch session.");
        }
    }
}
