using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class ManagedSvgAcceptance
    {
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
        private static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value));
        private static void Require(bool value, string error) { if (!value) throw new InvalidOperationException(error); }
        private static W.ContentControl Control(W.Document document, string id)
        {
            var controls = document.SelectContentControlsByTag("latexsnipper:formula:" + id);
            try { Require(controls.Count == 1, "Ambiguous fixture control."); return controls[1]; }
            finally { Marshal.ReleaseComObject(controls); }
        }

        internal static int Run(W.Application app, ref W.Document document, WordAdapter adapter, string directory)
        {
            uint clipboard = GetClipboardSequenceNumber();
            var payloads = new List<FormulaPayload>();
            var checks = new List<object>();
            string error = null;
            try
            {
                foreach (string letter in new[] { "x", "y" })
                {
                    Console.WriteLine("Managed SVG " + letter + ": prepare insertion");
                    var content = document.Content;
                    var insertion = document.Range(content.End - 1, content.End - 1);
                    Marshal.ReleaseComObject(content);
                    insertion.InsertParagraphBefore();
                    insertion.Collapse(W.WdCollapseDirection.wdCollapseEnd);
                    insertion.Select(); Marshal.ReleaseComObject(insertion);
                    string source = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:fs='urn:latexsnipper:formula-source:v1' width='24' height='24'>" +
                        "<metadata><fs:source format='latex'>" + letter + "^2</fs:source></metadata>" +
                        "<rect width='24' height='24' fill='" + (letter == "x" ? "#2563eb" : "#10b981") + "'/></svg>";
                    var payload = new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = letter + "^2", Display = "inline",
                        StorageMode = "image", Render = new RenderData { Svg = source, WidthPt = 24, HeightPt = 24 },
                        ContentKind = "drawing", EditorState = JsonSerializer.Deserialize<JsonElement>("{\"source\":\"" + letter + "^2\"}") };
                    Console.WriteLine("Managed SVG " + letter + ": insert");
                    var result = adapter.InsertFormula(payload, InsertMode.Inline);
                    Console.WriteLine("Managed SVG " + letter + ": inserted");
                    Require(result.Success, "SVG insertion failed: " + result.Error);
                    Require(payload.Source?.WordSvgBinding != null, "SVG binding was not created.");
                    payloads.Add(Clone(payload));
                    Check(document, adapter, payload, "inserted", checks);
                }
                string path = Path.Combine(directory, "managed-svg-source.docx");
                Console.WriteLine("Managed SVG: save/reopen");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(document); document = null;
                var documents = app.Documents;
                try { document = documents.Open(path, ReadOnly: false, AddToRecentFiles: false, Visible: false); }
                finally { Marshal.ReleaseComObject(documents); }
                foreach (var payload in payloads) Check(document, adapter, payload, "reopened", checks);

                Console.WriteLine("Managed SVG: unsupported nested update preserves original");
                var update = adapter.ReplaceFormula(payloads[0].FormulaId, Clone(payloads[0]));
                Require(!update.Success && update.ErrorCode == "SVG_UPDATE_BOUNDARY_UNSUPPORTED",
                    "Unsupported nested SVG update was not rejected before mutation.");
                Check(document, adapter, payloads[0], "unsupported-update-preserved", checks);
                checks.Add(new { stage = "update-boundary", nestedUpdateSupported = false, originalPreserved = true });

                var first = payloads[0];
                var control = Control(document, first.FormulaId);
                var range = control.Range;
                try
                {
                    var corrupt = Clone(first); corrupt.Latex = "stale-source";
                    FormulaDocumentManifest.Write(document, corrupt); range.Select();
                    Require(adapter.ReadSelection() == null && adapter.ReadFormulaById(first.FormulaId) == null,
                        "Changed source passed binding verification.");
                    FormulaDocumentManifest.Write(document, first);
                    Check(document, adapter, first, "restored-source", checks);
                    var sourceShapes = range.InlineShapes;
                    var sourcePicture = sourceShapes[1];
                    var sourceRange = sourcePicture.Range;
                    sourceRange.Select();
                    var nested = Clone(payloads[1]); nested.FormulaId = FormulaIdHelper.NewId();
                    var nesting = adapter.InsertFormula(nested, InsertMode.Inline);
                    Marshal.ReleaseComObject(sourceRange); Marshal.ReleaseComObject(sourcePicture); Marshal.ReleaseComObject(sourceShapes);
                    Require(!nesting.Success && nesting.ErrorCode == "IMAGE_INSIDE_MANAGED_FORMULA", "Nested image insertion was not rejected.");
                    Check(document, adapter, first, "nested-insert-rejected", checks);
                    var legacy = Clone(first); legacy.Source.WordSvgBinding = null;
                    FormulaDocumentManifest.Write(document, legacy); range.Select();
                    Require(adapter.ReadSelection()?.Source?.WordSvgBinding == null && adapter.ReadSelection()?.Latex == first.Latex,
                        "Legacy unverified payload was not preserved.");
                    FormulaDocumentManifest.Write(document, first);
                    var end = document.Content;
                    var duplicatePoint = document.Range(end.End - 1, end.End - 1); Marshal.ReleaseComObject(end);
                    var duplicate = document.ContentControls.Add(W.WdContentControlType.wdContentControlRichText, duplicatePoint);
                    Marshal.ReleaseComObject(duplicatePoint);
                    try
                    {
                        duplicate.Tag = "latexsnipper:formula:" + first.FormulaId; range.Select();
                        Require(adapter.ReadSelection() == null && adapter.ReadFormulaById(first.FormulaId) == null,
                            "Duplicate object ID passed binding verification.");
                    }
                    finally { duplicate.Delete(false); Marshal.ReleaseComObject(duplicate); }
                    Check(document, adapter, first, "duplicate-removed", checks);

                    string replacementPath = Path.Combine(directory, "replacement.svg");
                    File.WriteAllText(replacementPath, payloads[1].Render.Svg);
                    // Replace the carrier outside its old SDT, then restore only
                    // the tag. The unchanged manifest must not authenticate it.
                    control.Delete(false); Marshal.ReleaseComObject(control); control = null;
                    var shapes = range.InlineShapes;
                    var oldPicture = shapes[1];
                    oldPicture.Delete(); Marshal.ReleaseComObject(oldPicture); Marshal.ReleaseComObject(shapes);
                    var point = range.Duplicate; point.Collapse(W.WdCollapseDirection.wdCollapseStart);
                    shapes = point.InlineShapes;
                    var replaced = shapes.AddPicture(replacementPath, LinkToFile: false, SaveWithDocument: true, Range: point);
                    var replacedRange = replaced.Range;
                    var controls = document.ContentControls;
                    try { control = controls.Add(W.WdContentControlType.wdContentControlRichText, replacedRange); }
                    finally { Marshal.ReleaseComObject(controls); Marshal.ReleaseComObject(replacedRange); }
                    control.Tag = "latexsnipper:formula:" + first.FormulaId;
                    Marshal.ReleaseComObject(replaced); Marshal.ReleaseComObject(shapes); Marshal.ReleaseComObject(point);
                    Marshal.ReleaseComObject(range); range = control.Range;
                    range.Select();
                    Require(adapter.ReadSelection() == null && adapter.ReadFormulaById(first.FormulaId) == null,
                        "Replaced Word picture returned the old source.");
                    var rejected = adapter.ReplaceFormula(first.FormulaId, Clone(first));
                    Require(!rejected.Success && rejected.ErrorCode == "OFFICE_TARGET_CHANGED", "Changed carrier was overwritten.");
                    checks.Add(new { stage = "guards", changedSourceRejected = true, duplicateIdRejected = true,
                        replacedPictureRejected = true, staleUpdateRejected = true, nestedInsertionRejected = true, legacyUnverifiedCompatible = true });
                }
                finally { Marshal.ReleaseComObject(range); if (control != null) Marshal.ReleaseComObject(control); }
                Require(clipboard == GetClipboardSequenceNumber(), "Clipboard changed.");
            }
            catch (Exception exception) { error = exception.ToString(); }
            File.WriteAllText(Path.Combine(directory, "managed-svg-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, status = error == null ? "passed" : "failed", wordVersion = app.Version, wordBuild = app.Build,
                checks, clipboardUnchanged = clipboard == GetClipboardSequenceNumber(), pipeVerified = false, error,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine(error ?? "Managed SVG source binding, save/reopen and stale-carrier guards passed.");
            return error == null ? 0 : 1;
        }

        private static void Check(W.Document document, WordAdapter adapter, FormulaPayload payload, string stage, List<object> checks)
        {
            var control = Control(document, payload.FormulaId);
            var range = control.Range;
            var content = document.Content;
            var shapes = range.InlineShapes;
            var picture = shapes[1];
            W.Selection selection = null;
            var application = document.Application;
            try
            {
                range.Select();
                string text = content.Text;
                bool saved = document.Saved;
                float width = picture.Width, height = picture.Height;
                var read = adapter.ReadSelection();
                Require(read != null && read.Latex == payload.Latex && read.Render.Svg == payload.Render.Svg &&
                    WordSvgSourceBinding.Matches(read, range.WordOpenXML), "Managed source or carrier identity was not retained.");
                Require(adapter.ReadFormulaById(payload.FormulaId)?.Render?.Svg == payload.Render.Svg, "ID readback lost original SVG.");
                selection = application.Selection;
                Require(text == content.Text && saved == document.Saved && width == picture.Width && height == picture.Height &&
                    selection.Start == range.Start && selection.End == range.End, "Readback changed document/selection/geometry.");
                checks.Add(new { stage, originalSvgAndSourceRetained = true, carrierBindingVerified = true,
                    textGeometrySelectionSavedStateUnchanged = true });
            }
            finally
            {
                if (selection != null) Marshal.ReleaseComObject(selection);
                Marshal.ReleaseComObject(application); Marshal.ReleaseComObject(picture); Marshal.ReleaseComObject(shapes);
                Marshal.ReleaseComObject(content); Marshal.ReleaseComObject(range); Marshal.ReleaseComObject(control);
            }
        }
    }
}
