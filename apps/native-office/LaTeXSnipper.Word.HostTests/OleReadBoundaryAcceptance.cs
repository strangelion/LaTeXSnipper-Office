using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class OleReadBoundaryAcceptance
    {
        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        internal static int Run(W.Application application, ref W.Document document,
            WordAdapter adapter, string input, string directory)
        {
            var checks = new List<object>();
            string error = null;
            string originalHash = Hash(input);
            uint clipboard = GetClipboardSequenceNumber();
            try
            {
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                string copy = Path.Combine(directory, "owned-ole-read.docx");
                File.Copy(input, copy, false);
                document = application.Documents.Open(copy, ReadOnly: false, AddToRecentFiles: false);
                string originalText = document.Content.Text;
                var manifest = FormulaDocumentManifest.ReadAll(document);
                foreach (var entry in manifest)
                {
                    if (entry.Value.StorageMode != "ole") continue;
                    W.ContentControls controls = null;
                    W.ContentControl control = null;
                    W.Range range = null;
                    W.InlineShape shape = null;
                    W.OLEFormat format = null;
                    try
                    {
                        controls = document.SelectContentControlsByTag("latexsnipper:formula:" + entry.Key);
                        if (controls.Count != 1) throw new InvalidOperationException("Owned OLE control was not unique.");
                        control = controls[1];
                        range = control.Range;
                        shape = range.InlineShapes[1];
                        format = shape.OLEFormat;
                        string progId = format.ProgID;
                        float width = shape.Width, height = shape.Height;
                        range.Select();
                        Validate(adapter.ReadSelection(), entry.Value);
                        // Only the disposable in-memory copy loses its manifest.
                        // This forces the ID reader to use the guarded OLE path.
                        FormulaDocumentManifest.Remove(document, entry.Key);
                        Validate(adapter.ReadFormulaById(entry.Key), entry.Value);
                        if (shape.Width != width || shape.Height != height || document.Content.Text != originalText)
                            throw new InvalidOperationException("Owned OLE read changed geometry or document text.");
                        checks.Add(new { progId, selectedRead = true, idReadWithoutManifest = true,
                            geometryAndTextUnchanged = true });
                    }
                    finally
                    {
                        if (format != null) Marshal.ReleaseComObject(format);
                        if (shape != null) Marshal.ReleaseComObject(shape);
                        if (range != null) Marshal.ReleaseComObject(range);
                        if (control != null) Marshal.ReleaseComObject(control);
                        if (controls != null) Marshal.ReleaseComObject(controls);
                    }
                }
                if (checks.Count == 0) throw new InvalidOperationException("No persisted owned OLE fixture was tested.");
                var newPayload = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(manifest.Values.First()));
                newPayload.FormulaId = FormulaIdHelper.NewId();
                newPayload.Display = "inline";
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document);
                document = null;
                document = application.Documents.Add();
                document.Content.Text = "FreshBefore FreshAfter\r";
                var tail = document.Range(document.Content.End - 1, document.Content.End - 1);
                try { tail.Select(); }
                finally { Marshal.ReleaseComObject(tail); }
                var inserted = adapter.InsertFormula(newPayload, InsertMode.Inline);
                if (!inserted.Success) throw new InvalidOperationException("New owned OLE acquisition rejected: " + inserted.Error);
                Validate(adapter.ReadFormulaById(newPayload.FormulaId), newPayload);
                checks.Add(new { freshOwnedInsertion = true });
                if (Hash(input) != originalHash || GetClipboardSequenceNumber() != clipboard)
                    throw new InvalidOperationException("Read changed the input file or clipboard.");
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "owned-ole-read-evidence.json"), JsonSerializer.Serialize(new {
                status = error == null ? "passed" : "failed", checks, error,
                inputUnchanged = Hash(input) == originalHash,
                clipboardUnchanged = GetClipboardSequenceNumber() == clipboard,
                scope = "Owned Word OLE selection/ID reads and new insertion; no third-party OLE activation or formula import tested"
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }

        private static void Validate(FormulaPayload actual, FormulaPayload expected)
        {
            if (actual == null || actual.FormulaId != expected.FormulaId || actual.Latex != expected.Latex ||
                actual.Omml != expected.Omml || actual.Revision != expected.Revision)
                throw new InvalidOperationException("Guarded OLE read mismatch: " + JsonSerializer.Serialize(new {
                    missing = actual == null,
                    identity = actual?.FormulaId == expected.FormulaId,
                    latex = actual?.Latex == expected.Latex,
                    omml = actual?.Omml == expected.Omml,
                    revision = actual?.Revision == expected.Revision,
                    storage = actual?.StorageMode
                }));
        }

        private static string Hash(string path)
        {
            using (var hash = SHA256.Create())
            using (var file = File.OpenRead(path))
                return BitConverter.ToString(hash.ComputeHash(file));
        }
    }
}
