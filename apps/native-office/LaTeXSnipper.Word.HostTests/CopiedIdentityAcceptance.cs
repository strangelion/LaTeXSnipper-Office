using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class CopiedIdentityAcceptance
    {
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
        private static void Check(bool valid, string error) { if (!valid) throw new InvalidOperationException(error); }
        private static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
        private static FormulaPayload Payload(AcceptanceCase fixture, string mode)
        {
            var value = new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = fixture.Latex, Omml = fixture.Omml,
                Display = "inline", StorageMode = mode == "svg" ? "image" : mode, Revision = 7 };
            using (var state = JsonDocument.Parse("{\"schemaVersion\":1,\"marker\":\"word-copy\"}")) value.EditorState = state.RootElement.Clone();
            if (mode == "image")
                using (var bitmap = new Bitmap(24, 12))
                using (var graphics = Graphics.FromImage(bitmap))
                using (var bytes = new MemoryStream())
                { graphics.Clear(Color.White); graphics.DrawLine(Pens.Black, 2, 6, 21, 6); bitmap.Save(bytes, ImageFormat.Png);
                    value.Render = new RenderData { Png = Convert.ToBase64String(bytes.ToArray()), WidthPt = 36, HeightPt = 18 }; }
            if (mode == "svg") value.Render = new RenderData { Svg =
                "<svg xmlns='http://www.w3.org/2000/svg' width='36' height='18'><path d='M2 9H34' stroke='#18212f'/></svg>",
                WidthPt = 36, HeightPt = 18 };
            return value;
        }
        public static int Run(W.Application app, ref W.Document doc, AcceptanceCase fixture, string directory)
        {
            var checks = new List<object>(); string error = null; uint clipboard = GetClipboardSequenceNumber();
            try
            {
                foreach (string mode in new[] { "native-omml", "auto", "image", "svg" })
                {
                    var adapter = new WordAdapter(app); var payload = Payload(fixture, mode);
                    adapter.CopiedIdentityFingerprintMismatchForTest = (expected, actual) => {
                        File.WriteAllText(Path.Combine(directory, "expected-" + mode + ".txt"), expected);
                        File.WriteAllText(Path.Combine(directory, "observed-" + mode + ".txt"), actual);
                    };
                    doc.Content.Text = "Before After\r";
                    var anchor = doc.Range(7, 7);
                    try
                    {
                        if (mode == "native-omml") Check(adapter.InsertNativeInlineAt(doc, anchor, payload).Success, "Native authored insertion failed.");
                        else
                        {
                            anchor.Select(); var inserted = adapter.InsertFormula(payload, InsertMode.Inline);
                            Check(inserted.Success, "Authored insertion failed for " + mode + ": " + inserted.ErrorCode + ": " + inserted.Error);
                        }
                    }
                    finally { Release(anchor); }
                    string tag = "latexsnipper:formula:" + payload.FormulaId;
                    var controls = doc.SelectContentControlsByTag(tag); var original = controls[1]; Release(controls);
                    var originalRange = original.Range;
                    string originalControlId = original.ID, originalFingerprint = WordAdapter.DeleteSourceFingerprint(originalRange.WordOpenXML);
                    int originalRevision = FormulaDocumentManifest.Read(doc, payload.FormulaId).Revision;
                    var enclosing = doc.Range(originalRange.Start - 1, originalRange.End + 1);
                    string copiedXml;
                    try { copiedXml = enclosing.WordOpenXML; Check(copiedXml.Contains(tag), "Authored copy does not include control identity."); }
                    finally { Release(enclosing); Release(originalRange); }
                    var end = doc.Range(doc.Content.End - 1, doc.Content.End - 1);
                    try { end.InsertXML(copiedXml); } finally { Release(end); }
                    controls = doc.SelectContentControlsByTag(tag);
                    W.ContentControl copied = null;
                    try
                    {
                        Check(controls.Count == 2, "Word XML copy did not retain duplicate managed tags.");
                        for (int index = 1; index <= controls.Count; index++)
                        { var item = controls[index]; if (item.ID != originalControlId) copied = item; else Release(item); }
                    }
                    finally { Release(controls); }
                    Check(copied != null, "Copied control was not independently identified.");
                    var copiedRange = copied.Range; string copiedControlId = copied.ID;
                    bool rejected = false;
                    try { adapter.ReadFormulaById(payload.FormulaId); }
                    catch (HostIdentityReconciliationException) { rejected = true; }
                    Check(rejected, "Read by duplicate ID silently selected an original.");
                    rejected = false;
                    try { adapter.ReadManagedFormulaSelection(doc.Content); }
                    catch (HostIdentityReconciliationException) { rejected = true; }
                    Check(rejected && copied.Tag == tag && original.Tag == tag, "Multi-formula selection was not non-mutating.");
                    adapter.CopiedIdentityAfterTagForTest = () => { throw new InvalidOperationException("Authored identity write-after fault."); };
                    rejected = false;
                    try { adapter.ReadManagedFormulaSelection(copiedRange); }
                    catch (HostIdentityReconciliationException failure) { rejected = failure.ErrorCode == "HOST_IDENTITY_RECONCILE_FAILED"; }
                    finally { adapter.CopiedIdentityAfterTagForTest = null; }
                    Check(rejected && copied.Tag == tag && original.Tag == tag && FormulaDocumentManifest.ReadAll(doc).Count == 1,
                        "Failed tag write did not restore both identity and original manifest.");
                    var read = adapter.ReadManagedFormulaSelection(copiedRange);
                    Check(read.FormulaId != payload.FormulaId && FormulaIdHelper.IsCanonical(read.FormulaId) && read.Revision == 0 &&
                        copied.ID == copiedControlId && copied.Tag == "latexsnipper:formula:" + read.FormulaId && original.Tag == tag &&
                        read.EditorState.Value.GetProperty("marker").GetString() == "word-copy", "Word copy adoption changed original or lost source.");
                    originalRange = original.Range;
                    try { Check(WordAdapter.DeleteSourceFingerprint(originalRange.WordOpenXML) == originalFingerprint,
                        "Original content or style changed during copy adoption."); }
                    finally { Release(originalRange); }
                    var stored = FormulaDocumentManifest.ReadAll(doc);
                    Check(stored.Count == 2 && stored[payload.FormulaId].Revision == originalRevision &&
                        stored[read.FormulaId].Latex == payload.Latex && stored[read.FormulaId].Render?.Png == payload.Render?.Png &&
                        stored[read.FormulaId].Render?.Svg == payload.Render?.Svg &&
                        ManifestDiagnostics.ValidateWord(doc).IsConsistent, "Word copied manifest is inconsistent.");
                    copiedRange.Select(); var productionRead = adapter.ReadSelection();
                    Check(productionRead?.FormulaId == read.FormulaId, "Production selection read did not use captured copied identity.");
                    Check(adapter.ReadFormulaById(payload.FormulaId)?.FormulaId == payload.FormulaId &&
                        adapter.ReadFormulaById(read.FormulaId)?.FormulaId == read.FormulaId, "Word copied IDs were not independent.");
                    Release(copiedRange); Release(copied); Release(original);
                    string path = Path.Combine(directory, "copied-word-" + mode + ".docx");
                    doc.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument); doc.Close(W.WdSaveOptions.wdDoNotSaveChanges); Release(doc); doc = null;
                    doc = app.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true); Program.RequireHiddenWord(app);
                    controls = doc.SelectContentControlsByTag("latexsnipper:formula:" + read.FormulaId); copied = controls[1]; Release(controls);
                    copiedRange = copied.Range;
                    try { Check(adapter.ReadManagedFormulaSelection(copiedRange)?.FormulaId == read.FormulaId &&
                        ManifestDiagnostics.ValidateWord(doc).IsConsistent, "Read-only reopened copied source changed."); }
                    finally { Release(copiedRange); Release(copied); }
                    doc.Close(W.WdSaveOptions.wdDoNotSaveChanges); Release(doc); doc = null;
                    doc = app.Documents.Open(path, ReadOnly: false, AddToRecentFiles: false, Visible: true); Program.RequireHiddenWord(app);
                    controls = doc.SelectContentControlsByTag(tag); original = controls[1]; Release(controls); originalRange = original.Range;
                    string beforeDeletion = WordAdapter.DeleteSourceFingerprint(originalRange.WordOpenXML);
                    Release(originalRange);
                    var deletion = adapter.DeleteFormulaInDocument(doc, read.FormulaId);
                    originalRange = original.Range;
                    bool originalKept;
                    try { originalKept = WordAdapter.DeleteSourceFingerprint(originalRange.WordOpenXML) == beforeDeletion; }
                    finally { Release(originalRange); Release(original); }
                    Check(deletion.Success && FormulaDocumentManifest.ReadAll(doc).Count == 1 &&
                        FormulaDocumentManifest.Read(doc, payload.FormulaId).Latex == payload.Latex &&
                        ManifestDiagnostics.ValidateWord(doc).IsConsistent && originalKept && doc.Content.Text.Contains("Before") && doc.Content.Text.Contains("After"),
                        "Deleting the copied ID changed the original or failed: " + deletion.ErrorCode + ": " + deletion.Error);
                    checks.Add(new { mode, authoredWordXmlCopy = true, independentIdentity = true, originalContentUnchanged = true,
                        sourceAndStateRetained = true, productionReadVerified = true, readOnlyReopenVerified = true,
                        ambiguousReadsNonMutating = true, tagWriteFaultRestored = true, copiedDeletionKeepsOriginal = true });
                    doc.Close(W.WdSaveOptions.wdDoNotSaveChanges); Release(doc); doc = app.Documents.Add(Visible: true); Program.RequireHiddenWord(app);
                }
            }
            catch (Exception failure) { error = failure.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "word-copied-identity-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, checks, error, status = error == null ? "passed" : "failed", clipboardUnchanged = clipboard == GetClipboardSequenceNumber(),
                pipeVerified = false, scope = "Hidden direct Word adapters, authored XML duplication of native OMML, PNG and bound SVG controls. No OS clipboard, OLE copy or installed add-in claim."
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }
    }
}
