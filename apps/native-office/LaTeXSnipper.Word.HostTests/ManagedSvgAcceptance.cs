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
        private static bool Rejected(Func<FormulaPayload> read)
        {
            try { return read() == null; }
            catch (HostIdentityReconciliationException error) { return error.ErrorCode.StartsWith("HOST_IDENTITY_", StringComparison.Ordinal); }
        }
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
                    insertion.InsertAfter("before-" + letter + " ");
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
                    var insertedControl = Control(document, payload.FormulaId);
                    var insertedRange = insertedControl.Range;
                    var paragraphs = insertedRange.Paragraphs;
                    var paragraph = paragraphs[1];
                    var suffix = paragraph.Range;
                    suffix.SetRange(suffix.End - 1, suffix.End - 1); suffix.InsertAfter(" after-" + letter);
                    Marshal.ReleaseComObject(suffix); Marshal.ReleaseComObject(paragraph); Marshal.ReleaseComObject(paragraphs);
                    Marshal.ReleaseComObject(insertedRange); Marshal.ReleaseComObject(insertedControl);
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

                Console.WriteLine("Managed SVG: inline update");
                string differentCarrier = payloads[0].Render.Svg;
                var proposed = Clone(payloads[1]); proposed.FormulaId = payloads[0].FormulaId;
                proposed.Revision = payloads[0].Revision;
                string beforeUpdate = document.Content.Text;
                int documentsBefore = app.Documents.Count;
                var update = adapter.ReplaceFormula(payloads[0].FormulaId, proposed);
                Require(update.Success, "Inline SVG update failed: " + update.ErrorCode + " " + update.Error);
                Require(document.Content.Text == beforeUpdate && app.Documents.Count == documentsBefore, "Update changed body or leaked a scratch document.");
                var readUpdated = adapter.ReadFormulaById(payloads[0].FormulaId);
                Require(readUpdated != null, "Updated SVG is not readable after scratch cleanup.");
                payloads[0] = Clone(readUpdated);
                Require(payloads[0].Revision == 1 && payloads[0].Latex == proposed.Latex, "Update lost identity/source/revision.");
                Check(document, adapter, payloads[0], "updated", checks);
                checks.Add(new { stage = "update-boundary", inlineUpdateSupported = true, bodyPreserved = true, scratchClosed = true });
                var good = Clone(payloads[0]);
                var next = Clone(good); next.Latex = "z^3";
                next.Render.Svg = differentCarrier;
                next.Render.WidthPt = 48; next.Render.HeightPt = 12;
                next.Presentation = new PresentationData { StyleProfile = JsonSerializer.Deserialize<JsonElement>("{\"schemaVersion\":1,\"layout\":{\"baselineShiftPt\":7}}") };
                var rollbackControl = Control(document, good.FormulaId);
                var rollbackRange = rollbackControl.Range; var rollbackShapes = rollbackRange.InlineShapes;
                var rollbackShape = rollbackShapes[1];
                rollbackShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
                Marshal.ReleaseComObject(rollbackShape); Marshal.ReleaseComObject(rollbackShapes);
                Marshal.ReleaseComObject(rollbackRange); Marshal.ReleaseComObject(rollbackControl);
                var originalGeometry = Geometry(document, good.FormulaId);
                string beforeRollback = JsonSerializer.Serialize(good);
                adapter.SvgUpdateAfterSwapForTest = () => { throw new InvalidOperationException("fixture-post-swap-failure"); };
                InsertResult rolledBack;
                try { rolledBack = adapter.ReplaceFormula(good.FormulaId, next); }
                finally { adapter.SvgUpdateAfterSwapForTest = null; }
                Require(!rolledBack.Success && rolledBack.ErrorCode == "SVG_UPDATE_FAILED", "Injected failure did not roll back: " + rolledBack.ErrorCode);
                Require(JsonSerializer.Serialize(adapter.ReadFormulaById(good.FormulaId)) == beforeRollback &&
                    document.Content.Text == beforeUpdate && app.Documents.Count == documentsBefore,
                    "Rollback lost original source/body or leaked the scratch document.");
                Require(Geometry(document, good.FormulaId) == originalGeometry, "Rollback lost dimensions or baseline style.");
                Check(document, adapter, good, "rollback-verified", checks);
                var invalid = Clone(good); invalid.Render.WidthPt = float.NaN;
                var invalidResult = adapter.ReplaceFormula(good.FormulaId, invalid);
                Require(!invalidResult.Success && invalidResult.ErrorCode == "SVG_UPDATE_RENDER_INVALID" &&
                    JsonSerializer.Serialize(adapter.ReadFormulaById(good.FormulaId)) == beforeRollback && document.Content.Text == beforeUpdate,
                    "Invalid geometry modified the source.");
                var empty = Clone(good); empty.Render.Svg = " ";
                var emptyResult = adapter.ReplaceFormula(good.FormulaId, empty);
                Require(!emptyResult.Success && emptyResult.ErrorCode == "SVG_UPDATE_RENDER_INVALID" &&
                    JsonSerializer.Serialize(adapter.ReadFormulaById(good.FormulaId)) == beforeRollback && document.Content.Text == beforeUpdate,
                    "Empty SVG modified the source.");
                var unsupported = Clone(good); unsupported.Display = "block";
                var unsupportedResult = adapter.ReplaceFormula(good.FormulaId, unsupported);
                Require(!unsupportedResult.Success && unsupportedResult.ErrorCode == "SVG_UPDATE_BOUNDARY_UNSUPPORTED", "Unsupported display change was accepted.");
                var stale = Clone(good); stale.Revision--;
                Require(adapter.ReplaceFormula(good.FormulaId, stale).ErrorCode == "OFFICE_TARGET_CHANGED", "Stale revision was accepted.");
                for (int iteration = 0; iteration < 3; iteration++)
                {
                    var repeated = Clone(payloads[0]);
                    repeated.Latex = "r_" + iteration + "^2";
                    repeated.Render.Svg = iteration % 2 == 0 ? differentCarrier : payloads[1].Render.Svg;
                    var repeatedResult = adapter.ReplaceFormula(repeated.FormulaId, repeated);
                    Require(repeatedResult.Success && document.Content.Text == beforeUpdate && app.Documents.Count == documentsBefore,
                        "Repeated update lost body order or leaked scratch state.");
                    payloads[0] = Clone(adapter.ReadFormulaById(repeated.FormulaId));
                    Require(payloads[0].Revision == iteration + 2, "Repeated update lost its revision.");
                }
                path = Path.Combine(directory, "managed-svg-updated.docx");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(document); document = null;
                documents = app.Documents;
                try { document = documents.Open(path, ReadOnly: false, AddToRecentFiles: false, Visible: false); }
                finally { Marshal.ReleaseComObject(documents); }
                foreach (var payload in payloads) Check(document, adapter, payload, "updated-reopened", checks);
                Require(document.Content.Text == beforeUpdate, "Save/reopen changed surrounding text.");
                checks.Add(new { stage = "update-regressions", postSwapRollbackVerified = true, invalidGeometryRejected = true,
                    emptySvgRejected = true, aspectLockRestored = true, staleRevisionRejected = true,
                    unsupportedDisplayRejected = true, repeatedUpdates = 3, updatedReopenVerified = true });
                CheckTableUpdate(document, adapter, payloads[1], checks);

                var first = payloads[0];
                var control = Control(document, first.FormulaId);
                var range = control.Range;
                try
                {
                    var corrupt = Clone(first); corrupt.Latex = "stale-source";
                    FormulaDocumentManifest.Write(document, corrupt); range.Select();
                    Require(Rejected(() => adapter.ReadSelection()) && Rejected(() => adapter.ReadFormulaById(first.FormulaId)),
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
                        Require(Rejected(() => adapter.ReadSelection()) && Rejected(() => adapter.ReadFormulaById(first.FormulaId)),
                            "Duplicate object ID passed binding verification.");
                    }
                    finally { duplicate.Delete(false); Marshal.ReleaseComObject(duplicate); }
                    Check(document, adapter, first, "duplicate-removed", checks);

                    string replacementPath = Path.Combine(directory, "replacement.svg");
                    File.WriteAllText(replacementPath, payloads[0].Render.Svg == differentCarrier ? payloads[1].Render.Svg : differentCarrier);
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
                    Require(Rejected(() => adapter.ReadSelection()) && Rejected(() => adapter.ReadFormulaById(first.FormulaId)),
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

        private static (float Width, float Height, int Baseline, int AspectLock) Geometry(W.Document document, string id)
        {
            var control = Control(document, id); var range = control.Range; var shapes = range.InlineShapes;
            var shape = shapes[1]; var pictureRange = shape.Range; var font = pictureRange.Font;
            try { return (shape.Width, shape.Height, font.Position, (int)shape.LockAspectRatio); }
            finally { Marshal.ReleaseComObject(font); Marshal.ReleaseComObject(pictureRange); Marshal.ReleaseComObject(shape);
                Marshal.ReleaseComObject(shapes); Marshal.ReleaseComObject(range); Marshal.ReleaseComObject(control); }
        }

        private static void CheckTableUpdate(W.Document document, WordAdapter adapter, FormulaPayload fixture, List<object> checks)
        {
            var content = document.Content;
            var end = document.Range(content.End - 1, content.End - 1); Marshal.ReleaseComObject(content);
            end.InsertParagraphBefore(); end.Collapse(W.WdCollapseDirection.wdCollapseEnd);
            var tables = document.Tables; var table = tables.Add(end, 1, 1); Marshal.ReleaseComObject(tables); Marshal.ReleaseComObject(end);
            table.AllowAutoFit = false;
            var columns = table.Columns; columns.SetWidth(72, W.WdRulerStyle.wdAdjustNone); Marshal.ReleaseComObject(columns);
            var cell = table.Cell(1, 1); var cellRange = cell.Range;
            cellRange.SetRange(cellRange.Start, cellRange.Start); cellRange.Select();
            var payload = Clone(fixture); payload.FormulaId = FormulaIdHelper.NewId(); payload.Revision = 0;
            var inserted = adapter.InsertFormula(payload, InsertMode.Inline);
            Require(inserted.Success, "Table fixture insertion failed: " + inserted.Error);
            string before = document.Content.Text;
            var enlarged = Clone(payload); enlarged.Render.WidthPt = 300; enlarged.Render.HeightPt = 150;
            var result = adapter.ReplaceFormula(payload.FormulaId, enlarged);
            Require(result.Success && document.Content.Text == before, "Table update failed or changed its text.");
            var geometry = Geometry(document, payload.FormulaId);
            Require(geometry.Width <= cell.Width - cell.LeftPadding - cell.RightPadding - 3.5f &&
                Math.Abs(geometry.Height / geometry.Width - 0.5f) < 0.02f, "Updated SVG overflowed its cell or lost aspect ratio.");
            checks.Add(new { stage = "table-update", containerFit = true, requestedWidthPt = 300,
                actualWidthPt = geometry.Width, actualHeightPt = geometry.Height });
            Marshal.ReleaseComObject(cellRange); Marshal.ReleaseComObject(cell); Marshal.ReleaseComObject(table);
        }
    }
}
