using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using Office = Microsoft.Office.Core;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class ManifestAppendAcceptance
    {
        public static int Run(InteropWord.Application app, ref InteropWord.Document doc, AcceptanceCase fixture, string directory)
        {
            var checks = new List<object>();
            string error = null;
            try
            {
                const string ns = "urn:latexsnipper:office:objects:v3";
                foreach (bool ambiguous in new[] { true, false })
                {
                    string source = $"Before ${fixture.Latex}$ After\r";
                    doc.Content.Text = source;
                    source = doc.Content.Text;
                    Office.CustomXMLPart first = doc.CustomXMLParts.Add(ambiguous
                        ? $"<lsno:manifest xmlns:lsno='{ns}'><foreign>keep existing</foreign></lsno:manifest>"
                        : $"<lsno:unexpected xmlns:lsno='{ns}'><foreign>keep existing</foreign></lsno:unexpected>");
                    Office.CustomXMLPart second = ambiguous ? doc.CustomXMLParts.Add($"<lsno:manifest xmlns:lsno='{ns}' />") : null;
                    string firstXml = first.XML;
                    string secondXml = second?.XML;
                    try
                    {
                        var candidate = new WordBatchLatexScanner(app, doc).Scan().Single();
                        var result = new WordBatchConversionExecutor(app, targetDocument: doc, useIncrementalManifest: true).Execute("manifest-conflict", new List<BatchConversionItem> {
                            new BatchConversionItem { SourceId = candidate.Id, SourceText = candidate.Source,
                                NormalizedLatex = candidate.NormalizedLatex, SourceHash = candidate.SourceHash,
                                Locator = candidate.Locator, Omml = fixture.Omml, Status = "converted" }
                        });
                        if (result.Converted != 0 || result.Failures.Count != 1 ||
                            !result.Failures[0].Error.StartsWith("BATCH_MANIFEST_WRITE_FAILED", StringComparison.Ordinal) ||
                            doc.Content.Text != source || doc.OMaths.Count != 0 || doc.ContentControls.Count != 0 ||
                            first.XML != firstXml || (second != null && second.XML != secondXml))
                            throw new InvalidOperationException("Manifest conflict check failed: " + JsonSerializer.Serialize(new {
                                result, source = doc.Content.Text, sourceMatches = doc.Content.Text == source,
                                equations = doc.OMaths.Count, controls = doc.ContentControls.Count,
                                firstUnchanged = first.XML == firstXml, secondUnchanged = second == null || second.XML == secondXml
                            }));
                        checks.Add(new { kind = ambiguous ? "duplicate-part" : "wrong-root", originalSourcePreserved = true,
                            candidatesRemoved = true, existingPartsUnchanged = true, result });
                    }
                    finally
                    {
                        // Only these authored fault parts are removed.
                        first.Delete(); Marshal.ReleaseComObject(first);
                        if (second != null) { second.Delete(); Marshal.ReleaseComObject(second); }
                    }
                }
                // Recover with a new session; retain unknown extension nodes in a valid part.
                var existing = doc.CustomXMLParts.Add("<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><foreign>keep existing</foreign></lsno:manifest>");
                string existingId = existing.Id;
                Marshal.ReleaseComObject(existing);
                var payload = new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = fixture.Latex,
                    Omml = fixture.Omml, Display = "inline", StorageMode = "native-omml" };
                using (var session = FormulaDocumentManifest.OpenWordAppendSession(doc))
                {
                    session.WriteNew(doc, payload);
                    // A replacement part must not silently inherit a live session.
                    var rewritten = (Office.CustomXMLPart)FormulaDocumentManifest.FindPart(doc);
                    try
                    {
                        if (rewritten.Id != existingId || !rewritten.XML.Contains("<foreign>keep existing</foreign>"))
                            throw new InvalidOperationException("Append changed the original part or its extension.");
                        rewritten.Delete();
                    }
                    finally { Marshal.ReleaseComObject(rewritten); }
                    var replacement = doc.CustomXMLParts.Add("<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><foreign>external part edit</foreign></lsno:manifest>");
                    existingId = replacement.Id;
                    string replacementXml = replacement.XML;
                    payload.FormulaId = FormulaIdHelper.NewId();
                    bool refused = false;
                    try { session.WriteNew(doc, payload); }
                    catch (InvalidOperationException changed) { refused = changed.Message == "BATCH_MANIFEST_PART_CHANGED"; }
                    try
                    {
                        if (!refused || replacement.XML != replacementXml)
                            throw new InvalidOperationException("Changed part was reused or overwritten.");
                    }
                    finally { Marshal.ReleaseComObject(replacement); }
                    checks.Add(new { kind = "changed-part", rejected = true, replacementUnchanged = true });
                }
                var extensionPart = (Office.CustomXMLPart)FormulaDocumentManifest.FindPart(doc);
                try
                {
                    var root = extensionPart.DocumentElement;
                    try { root.AppendChildSubtree($"<foreign id='{payload.FormulaId}'>keep existing ID</foreign>"); }
                    finally { Marshal.ReleaseComObject(root); }
                    string snapshot = extensionPart.XML;
                    bool collisionRefused = false;
                    using (var collision = FormulaDocumentManifest.OpenWordAppendSession(doc))
                    {
                        try { collision.WriteNew(doc, payload); }
                        catch (InvalidOperationException exists) { collisionRefused = exists.Message == "BATCH_MANIFEST_ID_EXISTS"; }
                    }
                    if (!collisionRefused || extensionPart.XML != snapshot)
                        throw new InvalidOperationException("Unknown extension ID was shadowed.");
                    checks.Add(new { kind = "extension-id-collision", rejected = true, existingEntryUnchanged = true });
                }
                finally { Marshal.ReleaseComObject(extensionPart); }
                payload.FormulaId = FormulaIdHelper.NewId();
                using (var fresh = FormulaDocumentManifest.OpenWordAppendSession(doc)) fresh.WriteNew(doc, payload);
                var part = (Office.CustomXMLPart)FormulaDocumentManifest.FindPart(doc);
                try
                {
                    if (part.Id != existingId || !part.XML.Contains("<foreign>external part edit</foreign>") ||
                        FormulaDocumentManifest.Read(doc, payload.FormulaId)?.Latex != payload.Latex)
                        throw new InvalidOperationException("Append replaced unrelated manifest data.");
                }
                finally { Marshal.ReleaseComObject(part); }
                var before = JsonSerializer.Serialize(FormulaDocumentManifest.ReadAll(doc));
                string path = Path.Combine(directory, "manifest-safety.docx");
                doc.SaveAs2(path, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                doc.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(doc); doc = null;
                doc = app.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                Program.RequireHiddenWord(app);
                if (before != JsonSerializer.Serialize(FormulaDocumentManifest.ReadAll(doc)))
                    throw new InvalidOperationException("Append payload changed after save/reopen.");
                checks.Add(new { kind = "recovery-and-extension", samePartRetained = true, saveReopenVerified = true });
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "manifest-safety-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, host = "word", wordVersion = app.Version, wordBuild = app.Build, checks, error,
                status = error == null ? "passed" : "failed", scope = "Authored native Word adapter cases; not installed Ribbon/pipe or third-party Office compatibility"
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }
    }
}
