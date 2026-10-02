using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Host;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class BatchAcceptance
    {
        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        public static int Run(InteropWord.Application application, ref InteropWord.Document document,
            AcceptanceCase fixture, string directory)
        {
            const int count = 250;
            var chunks = new List<object>();
            int converted = 0, skipped = 0, failed = 0;
            string error = null;
            bool reopened = false;
            uint clipboardBefore = GetClipboardSequenceNumber();
            var watch = Stopwatch.StartNew();
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
                var candidates = new WordBatchLatexScanner(application).Scan();
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
                items[125].Omml = "<invalid/>";
                var executor = new WordBatchConversionExecutor(application);
                for (int offset = 0; offset < count; offset += 25)
                {
                    var chunkWatch = Stopwatch.StartNew();
                    var result = executor.Execute("acceptance-" + offset,
                        items.Skip(offset).Take(25).ToList());
                    converted += result.Converted;
                    skipped += result.Skipped;
                    failed += result.Failed;
                    chunks.Add(new { offset, elapsedMs = chunkWatch.ElapsedMilliseconds, result });
                    Console.WriteLine($"batch offset={offset} converted={result.Converted} " +
                        $"skipped={result.Skipped} failed={result.Failed}");
                }
                if (converted != count - 1 || skipped != 1 || failed != 0)
                    throw new InvalidOperationException(
                        $"Expected 249/1/0 converted/skipped/failed, got {converted}/{skipped}/{failed}.");
                ValidateDocument(document, count);
                if (GetClipboardSequenceNumber() != clipboardBefore)
                    throw new InvalidOperationException("Native batch conversion changed the clipboard.");
                string path = Path.Combine(directory, "word-batch-acceptance.docx");
                document.SaveAs2(path, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                document.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Open(path, ReadOnly: true,
                    AddToRecentFiles: false, Visible: true);
                ValidateDocument(document, count);
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
                        schemaVersion = 1, host = "word", requested = count,
                        converted, skipped, failed, elapsedMs = watch.ElapsedMilliseconds,
                        clipboardUnchanged = GetClipboardSequenceNumber() == clipboardBefore,
                        saveReopenVerified = reopened, chunks, error,
                        status = error == null ? "passed" : "failed",
                        scope = "Native scanner/executor; pipe timeout and clipboard paste excluded"
                    }, new JsonSerializerOptions { WriteIndented = true }));
            }
            return error == null ? 0 : 1;
        }

        private static void ValidateDocument(InteropWord.Document document, int count)
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
        }
    }
}
