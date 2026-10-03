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
    internal static class FormatConversionAcceptance
    {
        internal static int Run(W.Application application, ref W.Document document, WordAdapter adapter,
            AcceptanceCase fixture, RenderData render, string directory)
        {
            var watch = Stopwatch.StartNew();
            var checks = new List<object>();
            var ids = new List<string>();
            string error = null;
            try
            {
                foreach (string display in new[] { "inline", "block" })
                {
                    string id = FormulaIdHelper.NewId(); ids.Add(id);
                    var point = document.Range(document.Content.End - 1, document.Content.End - 1);
                    point.InsertParagraphBefore(); point.Collapse(W.WdCollapseDirection.wdCollapseEnd); point.Select();
                    var source = new FormulaPayload {
                        FormulaId = id, Latex = fixture.Latex, Omml = fixture.Omml,
                        Display = display, StorageMode = "native-omml", Revision = 0,
                        CreatedUtcTicks = 638000000000000000, Render = render,
                        Presentation = new PresentationData { Color = "#000000", Alignment = "center" },
                    };
                    var inserted = adapter.InsertFormula(source, display == "inline" ? InsertMode.Inline : InsertMode.Display);
                    Require(inserted.Success, "Initial OMML failed: " + inserted.Error);
                    var initial = Clone(adapter.ReadFormulaById(id));
                    string beforeText = document.Content.Text;
                    string beforeMetadata = JsonSerializer.Serialize(initial);
                    int beforeMaths = document.Content.OMaths.Count;
                    var stale = Clone(initial); stale.Revision++;
                    var staleResult = adapter.ReplaceFormula(id, stale);
                    Require(!staleResult.Success && staleResult.ErrorCode == "OFFICE_TARGET_CHANGED" &&
                        document.Content.Text == beforeText && document.Content.OMaths.Count == beforeMaths &&
                        JsonSerializer.Serialize(adapter.ReadFormulaById(id)) == beforeMetadata,
                        "Stale revision protection failed: " + JsonSerializer.Serialize(staleResult));
                    var missingPreview = Clone(initial); missingPreview.StorageMode = "ole"; missingPreview.Render = null; missingPreview.Presentation.EmfBase64 = null;
                    var missing = adapter.ReplaceFormula(id, missingPreview);
                    Require(!missing.Success && document.Content.Text == beforeText && document.Content.OMaths.Count == beforeMaths &&
                        JsonSerializer.Serialize(adapter.ReadFormulaById(id)) == beforeMetadata && Control(document, id).Range.OMaths.Count == 1,
                        "Missing preview did not retain the original OMML.");
                    var ole = Clone(initial); ole.StorageMode = "ole";
                    var result = adapter.ReplaceFormula(id, ole);
                    Require(result.Success && result.StorageMode == "ole", "OMML to OLE failed: " + result.ErrorCode + " " + result.Error);
                    Validate(document, adapter, id, fixture.Latex, display, "ole", 1);
                    checks.Add(new { display, direction = "omml-to-ole", status = "passed", staleRevisionPreserved = true, missingPreviewPreserved = true });
                }
                Reopen(application, ref document, Path.Combine(directory, "ole-stage.docx"));
                foreach (string id in ids)
                {
                    var stored = Clone(adapter.ReadFormulaById(id));
                    Validate(document, adapter, id, fixture.Latex, stored.Display, "ole", 1);
                    stored.StorageMode = "native-omml";
                    var result = adapter.ReplaceFormula(id, stored);
                    Require(result.Success && result.StorageMode == "native-omml", "OLE to OMML failed: " + result.ErrorCode + " " + result.Error);
                    Validate(document, adapter, id, fixture.Latex, stored.Display, "native-omml", 2);
                    checks.Add(new { display = stored.Display, direction = "ole-to-omml", status = "passed", oleReopenVerified = true });
                }
                Reopen(application, ref document, Path.Combine(directory, "native-stage.docx"));
                foreach (string id in ids)
                    Validate(document, adapter, id, fixture.Latex, adapter.ReadFormulaById(id).Display, "native-omml", 2);
                checks.Add(new { name = "native-save-reopen", status = "passed" });
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            watch.Stop();
            File.WriteAllText(Path.Combine(directory, "format-conversion-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, host = "word", status = error == null ? "passed" : "failed",
                fixture = fixture.Name, latex = fixture.Latex, formulaIds = ids, seconds = watch.Elapsed.TotalSeconds,
                checks, error,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"Format conversion { (error == null ? "passed" : "failed") }: {watch.Elapsed.TotalSeconds:F3}s");
            return error == null ? 0 : 1;
        }
        private static FormulaPayload Clone(FormulaPayload payload) =>
            JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload)) ?? throw new InvalidOperationException("Missing formula payload.");
        private static W.ContentControl Control(W.Document document, string id) =>
            document.ContentControls.Cast<W.ContentControl>().Single(control => control.Tag == "latexsnipper:formula:" + id);
        private static void Validate(W.Document document, WordAdapter adapter, string id, string latex, string display, string storage, int revision)
        {
            var metadata = FormulaDocumentManifest.Read(document, id);
            Require(metadata != null && metadata.Latex == latex && metadata.Revision == revision && metadata.StorageMode == storage && metadata.Display == display,
                "Manifest identity/source/display/revision failed.");
            Require(metadata.CreatedUtcTicks == 638000000000000000 && metadata.Presentation.Color == "#000000", "Creation metadata/style lost.");
            var control = Control(document, id);
            if (storage == "ole")
            {
                Require(control.Range.InlineShapes.Count == 1, "OLE object not present.");
                var shape = control.Range.InlineShapes[1];
                Require(shape.Type == W.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject && shape.Width > 0 && shape.Height > 0, "Target is not a sized OLE object.");
                object automation = shape.OLEFormat.Object;
                Require(OleFormulaInterop.IsInitialized(automation) && OleFormulaInterop.VerifyRoundTrip(automation, metadata), "Embedded OLE payload did not match manifest.");
                var embedded = JsonSerializer.Deserialize<FormulaPayload>(OleFormulaInterop.GetPayloadJson(automation));
                Require(embedded.Revision == revision && embedded.FormulaId == id && embedded.Latex == latex, "Embedded revision/identity/source mismatch.");
            }
            else Require(control.Range.OMaths.Count == 1 && control.Range.InlineShapes.Count == 0, "Native target did not contain an editable OMath.");
            control.Range.Select();
            var selected = adapter.ReadSelection();
            Require(selected != null && selected.FormulaId == id && selected.Latex == latex && selected.Revision == revision, "Selection readback lost source or revision.");
        }
        private static void Reopen(W.Application application, ref W.Document document, string path)
        {
            document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
            document.Close(W.WdSaveOptions.wdSaveChanges); Marshal.ReleaseComObject(document); document = null;
            GC.Collect(); GC.WaitForPendingFinalizers();
            document = application.Documents.Open(FileName: path, ReadOnly: false, AddToRecentFiles: false, Visible: true);
        }
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    }
}
