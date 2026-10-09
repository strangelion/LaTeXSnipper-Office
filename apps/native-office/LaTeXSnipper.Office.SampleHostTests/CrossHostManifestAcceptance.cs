using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.Excel.Host;
using LaTeXSnipper.PowerPoint.Host;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using OfficeCore = Microsoft.Office.Core;
using InteropExcel = Microsoft.Office.Interop.Excel;
using Ppt = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.Office.SampleHostTests
{
    internal static class CrossHostManifestAcceptance
    {
        private const string Ns = "urn:latexsnipper:office:objects:v3";
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();

        private static FormulaPayload Payload()
        {
            using (var bitmap = new Bitmap(24, 12))
            using (var graphics = Graphics.FromImage(bitmap))
            using (var bytes = new MemoryStream())
            {
                graphics.Clear(Color.White); graphics.DrawLine(Pens.Black, 2, 6, 21, 6);
                bitmap.Save(bytes, ImageFormat.Png);
                return new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = "x^2", StorageMode = "image",
                    Render = new RenderData { Png = Convert.ToBase64String(bytes.ToArray()), WidthPt = 36, HeightPt = 18 } };
            }
        }

        private static void Check(bool valid, string reason)
        {
            if (!valid) throw new InvalidOperationException(reason);
        }

        private static string Snapshot(OfficeCore.CustomXMLParts parts)
        {
            OfficeCore.CustomXMLParts matching = parts.SelectByNamespace(Ns);
            try
            {
                Check(matching.Count == 1, "Expected one manifest part.");
                OfficeCore.CustomXMLPart part = matching[1];
                try { return part.XML; } finally { Marshal.ReleaseComObject(part); }
            }
            finally { Marshal.ReleaseComObject(matching); }
        }

        private static void ValidatePayload(string xml, FormulaPayload expected, string host)
        {
            var entries = XElement.Parse(xml).Elements("formula").ToList();
            var entry = entries.Single(value => (string)value.Attribute("id") == expected.FormulaId);
            var stored = JsonSerializer.Deserialize<FormulaPayload>(Encoding.UTF8.GetString(
                Convert.FromBase64String(entry.Element("payload").Value)));
            var expectedStored = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(expected));
            expectedStored.StorageMode = "image";
            Check(stored.FormulaId == expected.FormulaId && stored.Latex == expected.Latex && stored.StorageMode == "image" &&
                stored.Render.Png == expected.Render.Png && (string)entry.Element("locator").Attribute("host") == host &&
                JsonSerializer.Serialize(stored) == JsonSerializer.Serialize(expectedStored),
                "Manifest lost actual mode, source, render or host mapping.");
        }

        private static void RejectFaultParts(OfficeCore.CustomXMLParts parts, Func<bool> insert, Func<int> shapes, List<object> checks, string host)
        {
            foreach (bool duplicate in new[] { true, false })
            {
                var first = parts.Add(duplicate ? $"<lsno:manifest xmlns:lsno='{Ns}'><foreign>keep</foreign></lsno:manifest>" :
                    $"<lsno:wrong xmlns:lsno='{Ns}'><foreign>keep</foreign></lsno:wrong>");
                var second = duplicate ? parts.Add($"<lsno:manifest xmlns:lsno='{Ns}'/>") : null;
                string before = first.XML, secondBefore = second?.XML;
                int beforeShapes = shapes();
                try
                {
                    Check(!insert() && shapes() == beforeShapes && first.XML == before &&
                        (second == null || second.XML == secondBefore), "Metadata failure left a success/candidate or changed old parts.");
                    checks.Add(new { host, kind = duplicate ? "duplicate-part" : "wrong-root", failedInsertion = true,
                        newShapeRemoved = true, existingPartsUnchanged = true });
                }
                finally
                {
                    first.Delete(); Marshal.ReleaseComObject(first);
                    if (second != null) { second.Delete(); Marshal.ReleaseComObject(second); }
                }
            }
        }

        public static int Run(string directory, bool imageReplacement = false, bool deletion = false)
        {
            Directory.CreateDirectory(directory);
            var checks = new List<object>(); string error = null;
            uint clipboard = GetClipboardSequenceNumber();
            try { ExcelCase(directory, checks, imageReplacement, deletion); PowerPointCase(directory, checks, imageReplacement, deletion); }
            catch (Exception failure) { error = failure.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "cross-host-manifest-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, checks, error, status = error == null ? "passed" : "failed",
                clipboardUnchanged = GetClipboardSequenceNumber() == clipboard, pipeVerified = false,
                imageReplacement, deletion,
                scope = "Authored PNG insertion/replacement, metadata faults, layout and save/reopen. No OLE activation, installed add-in, UI or formula-to-image fidelity claim."
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }

        private static void ExcelCase(string directory, List<object> checks, bool imageReplacement, bool deletion)
        {
            InteropExcel.Application app = null; InteropExcel.Workbook book = null; InteropExcel.Worksheet sheet = null;
            OfficeCore.CustomXMLParts parts = null;
            try
            {
                app = new InteropExcel.Application { Visible = false, DisplayAlerts = false };
                book = app.Workbooks.Add(); sheet = (InteropExcel.Worksheet)book.Worksheets[1];
                var cell = (InteropExcel.Range)sheet.Cells[1, 1];
                try { cell.Value2 = "keep source text"; }
                finally { Marshal.ReleaseComObject(cell); }
                parts = book.CustomXMLParts; var adapter = new ExcelAdapter(app);
                RejectFaultParts(parts, () => {
                    var result = adapter.InsertFormula(Payload(), InsertMode.Inline);
                    Check(HostManifestInsertion.IsFailure(result.ErrorCode), "Excel did not propagate metadata failure.");
                    return result.Success;
                }, () => sheet.Shapes.Count, checks, "excel");
                var payload = Payload();
                var result = adapter.InsertFormula(payload, InsertMode.Inline);
                Check(result.Success && sheet.Shapes.Count == 1 && !app.Visible, "Excel image insertion failed or became visible.");
                var secondPayload = Payload();
                Check(adapter.InsertFormula(secondPayload, InsertMode.Inline).Success && sheet.Shapes.Count == 2,
                    "Excel second insertion failed.");
                if (imageReplacement)
                {
                    string duplicatePath = Path.Combine(directory, "duplicate-excel.png");
                    File.WriteAllBytes(duplicatePath, Convert.FromBase64String(payload.Render.Png));
                    var original = sheet.Shapes.Item("LSNO_" + payload.FormulaId);
                    try { payload = ReplaceImageCase(original, payload, parts,
                        value => adapter.ReplaceFormula(payload.FormulaId, value),
                        () => adapter.LastReplacementResult, () => sheet.Shapes.Count,
                        () => sheet.Shapes.Item("LSNO_" + payload.FormulaId),
                        () => sheet.Shapes.AddPicture(duplicatePath, OfficeCore.MsoTriState.msoFalse, OfficeCore.MsoTriState.msoTrue,
                            0, 0, 36, 18), checks, "excel"); }
                    finally { Marshal.ReleaseComObject(original); }
                }
                if (deletion)
                {
                    var original = sheet.Shapes.Item("LSNO_" + payload.FormulaId);
                    try { DeleteImageCase(original, payload, parts, () => adapter.DeleteFormulaDetailed(payload.FormulaId),
                        () => ManifestDiagnostics.ValidateExcel(book), () => ManifestDiagnostics.ValidateExcel(book, repairOrphans: true),
                        () => sheet.Shapes.Count, checks, "excel"); }
                    finally { Marshal.ReleaseComObject(original); }
                }
                string snapshot = Snapshot(parts);
                if (!deletion) ValidatePayload(snapshot, payload, "excel");
                ValidatePayload(snapshot, secondPayload, "excel");
                Marshal.ReleaseComObject(parts); parts = null;
                Marshal.ReleaseComObject(sheet); sheet = null;
                string path = Path.Combine(directory, "manifest-excel.xlsx");
                book.SaveAs(path, InteropExcel.XlFileFormat.xlOpenXMLWorkbook); book.Close(false); Marshal.ReleaseComObject(book); book = null;
                book = app.Workbooks.Open(path, ReadOnly: true); sheet = (InteropExcel.Worksheet)book.Worksheets[1]; parts = book.CustomXMLParts;
                cell = (InteropExcel.Range)sheet.Cells[1, 1];
                string originalText;
                try { originalText = (string)cell.Value2; }
                finally { Marshal.ReleaseComObject(cell); }
                Check(Snapshot(parts) == snapshot && sheet.Shapes.Count == (deletion ? 1 : 2) && originalText == "keep source text",
                    "Excel persisted shape, source or manifest changed.");
                if (deletion) Check(adapter.DeleteFormulaDetailed(secondPayload.FormulaId).ErrorCode == "HOST_DELETE_DOCUMENT_READ_ONLY" &&
                    sheet.Shapes.Count == 1 && Snapshot(parts) == snapshot, "Read-only Excel deletion changed remaining data.");
                if (imageReplacement) VerifyUpdatedPicture(sheet.Shapes.Item("LSNO_" + payload.FormulaId), payload);
                checks.Add(new { host = "excel", kind = "image-success", actualMode = result.ActualStorageMode,
                    fullPayloadVerified = true, priorEntryPreserved = true, objectCount = deletion ? 1 : 2,
                    saveReopenVerified = true, originalTextPreserved = true, version = app.Version });
            }
            finally
            {
                if (parts != null) Marshal.ReleaseComObject(parts);
                if (sheet != null) Marshal.ReleaseComObject(sheet);
                if (book != null) { book.Close(false); Marshal.ReleaseComObject(book); }
                if (app != null) { app.Quit(); Marshal.ReleaseComObject(app); }
            }
        }

        private static void PowerPointCase(string directory, List<object> checks, bool imageReplacement, bool deletion)
        {
            Ppt.Application app = null; Ppt.Presentation presentation = null; Ppt.Slide slide = null;
            OfficeCore.CustomXMLParts parts = null;
            try
            {
                app = new Ppt.Application(); presentation = app.Presentations.Add(OfficeCore.MsoTriState.msoFalse);
                slide = presentation.Slides.Add(1, Ppt.PpSlideLayout.ppLayoutBlank);
                var otherPresentation = app.Presentations.Add(OfficeCore.MsoTriState.msoFalse);
                bool mismatchedRejected = false;
                try
                {
                    try { new PowerPointAdapter(app, targetPresentation: otherPresentation, targetSlide: slide); }
                    catch (ArgumentException) { mismatchedRejected = true; }
                    Check(mismatchedRejected && slide.Shapes.Count == 0, "Mismatched target presentation was accepted.");
                    checks.Add(new { host = "powerpoint", kind = "target-identity", mismatchedRejected = true });
                }
                finally { otherPresentation.Close(); Marshal.ReleaseComObject(otherPresentation); }
                parts = presentation.CustomXMLParts;
                var adapter = new PowerPointAdapter(app, targetPresentation: presentation, targetSlide: slide);
                Check(app.Visible != OfficeCore.MsoTriState.msoTrue, "PowerPoint test application became visible.");
                RejectFaultParts(parts, () => {
                    var result = adapter.InsertFormula(Payload(), InsertMode.Inline);
                    Check(HostManifestInsertion.IsFailure(result.ErrorCode), "PowerPoint did not propagate metadata failure.");
                    return result.Success;
                }, () => slide.Shapes.Count, checks, "powerpoint");
                var payload = Payload(); var result = adapter.InsertFormula(payload, InsertMode.Inline);
                Check(result.Success && slide.Shapes.Count == 1, "PowerPoint image insertion failed.");
                var secondPayload = Payload();
                Check(adapter.InsertFormula(secondPayload, InsertMode.Inline).Success && slide.Shapes.Count == 2,
                    "PowerPoint second insertion failed.");
                if (imageReplacement)
                {
                    string duplicatePath = Path.Combine(directory, "duplicate-powerpoint.png");
                    File.WriteAllBytes(duplicatePath, Convert.FromBase64String(payload.Render.Png));
                    var original = slide.Shapes["LSNO_" + payload.FormulaId];
                    try { payload = ReplaceImageCase(original, payload, parts,
                        value => adapter.ReplaceFormula(payload.FormulaId, value),
                        () => adapter.LastReplacementResult, () => slide.Shapes.Count,
                        () => slide.Shapes["LSNO_" + payload.FormulaId],
                        () => slide.Shapes.AddPicture(duplicatePath, OfficeCore.MsoTriState.msoFalse, OfficeCore.MsoTriState.msoTrue,
                            0, 0, 36, 18), checks, "powerpoint"); }
                    finally { Marshal.ReleaseComObject(original); }
                }
                if (deletion)
                {
                    var original = slide.Shapes["LSNO_" + payload.FormulaId];
                    try { DeleteImageCase(original, payload, parts, () => adapter.DeleteFormulaDetailed(payload.FormulaId),
                        () => ManifestDiagnostics.ValidatePowerPoint(presentation), () => ManifestDiagnostics.ValidatePowerPoint(presentation, repairOrphans: true),
                        () => slide.Shapes.Count, checks, "powerpoint"); }
                    finally { Marshal.ReleaseComObject(original); }
                }
                string snapshot = Snapshot(parts);
                if (!deletion) ValidatePayload(snapshot, payload, "powerpoint");
                ValidatePayload(snapshot, secondPayload, "powerpoint");
                Marshal.ReleaseComObject(parts); parts = null; Marshal.ReleaseComObject(slide); slide = null;
                string path = Path.Combine(directory, "manifest-powerpoint.pptx");
                presentation.SaveAs(path, Ppt.PpSaveAsFileType.ppSaveAsOpenXMLPresentation);
                presentation.Close(); Marshal.ReleaseComObject(presentation); presentation = null;
                presentation = app.Presentations.Open(path, ReadOnly: OfficeCore.MsoTriState.msoTrue, WithWindow: OfficeCore.MsoTriState.msoFalse);
                slide = presentation.Slides[1]; parts = presentation.CustomXMLParts;
                Check(Snapshot(parts) == snapshot && slide.Shapes.Count == (deletion ? 1 : 2) && app.Visible != OfficeCore.MsoTriState.msoTrue,
                    "PowerPoint persisted shape/manifest changed or test became visible.");
                if (deletion)
                {
                    var reopened = new PowerPointAdapter(app, targetPresentation: presentation, targetSlide: slide);
                    Check(reopened.DeleteFormulaDetailed(secondPayload.FormulaId).ErrorCode == "HOST_DELETE_DOCUMENT_READ_ONLY" &&
                        slide.Shapes.Count == 1 && Snapshot(parts) == snapshot, "Read-only PowerPoint deletion changed remaining data.");
                }
                if (imageReplacement) VerifyUpdatedPicture(slide.Shapes["LSNO_" + payload.FormulaId], payload);
                checks.Add(new { host = "powerpoint", kind = "image-success", actualMode = result.ActualStorageMode,
                    fullPayloadVerified = true, priorEntryPreserved = true, objectCount = deletion ? 1 : 2,
                    saveReopenVerified = true, version = app.Version });
            }
            finally
            {
                if (parts != null) Marshal.ReleaseComObject(parts);
                if (slide != null) Marshal.ReleaseComObject(slide);
                if (presentation != null) { presentation.Close(); Marshal.ReleaseComObject(presentation); }
                if (app != null) { app.Quit(); Marshal.ReleaseComObject(app); }
            }
        }

        private static void DeleteImageCase(object original, FormulaPayload payload, OfficeCore.CustomXMLParts parts,
            Func<HostDeletionResult> delete, Func<ManifestValidationReport> diagnostic, Func<ManifestValidationReport> repair,
            Func<int> count, List<object> checks, string host)
        {
            string source = Snapshot(parts);
            var state = HostPictureSnapshot.Capture(original, host == "excel");
            var report = diagnostic();
            Check(report.IsConsistent && report.ObjectsFound == 2 && report.TotalEntries == 2 && report.RepairedCount == 0 && Snapshot(parts) == source,
                host + " diagnostic used wrong container or mutated read-only scan.");
            string orphanId = FormulaIdHelper.NewId();
            FormulaDocumentManifest.WriteEntry(parts, new FormulaPayload { FormulaId = orphanId, Latex = "orphan", StorageMode = "image" }, host);
            string orphanSnapshot = Snapshot(parts);
            var orphan = diagnostic();
            Check(orphan.OrphanEntries == 1 && orphan.RepairedCount == 0 && Snapshot(parts) == orphanSnapshot,
                host + " default diagnostic erased orphan source.");
            var repaired = repair();
            Check(repaired.IsConsistent && repaired.RepairedCount == 1 && !FormulaDocumentManifest.ReadAllEntries(parts).ContainsKey(orphanId),
                host + " explicit orphan repair was not verified.");
            source = Snapshot(parts);
            var matching = parts.SelectByNamespace(Ns);
            try { var part = matching[1]; try { part.Delete(); } finally { Marshal.ReleaseComObject(part); } }
            finally { Marshal.ReleaseComObject(matching); }
            try
            {
                RejectFaultParts(parts, () => {
                    var result = delete(); var failedScan = diagnostic();
                    Check(!result.Success && state.Matches(original) && !failedScan.IsConsistent && failedScan.HasErrors &&
                        !failedScan.ScanComplete && failedScan.RepairedCount == 0, host + " bad metadata deleted source or falsely passed scan.");
                    return result.Success;
                }, count, checks, host + "-delete");
            }
            finally { var restored = parts.Add(source); Marshal.ReleaseComObject(restored); }
            var deleted = delete();
            Check(deleted.Success && count() == 1 && !FormulaDocumentManifest.ReadAllEntries(parts).ContainsKey(payload.FormulaId) && diagnostic().IsConsistent,
                host + " explicit image deletion failed: " + deleted.ErrorCode + ": " + deleted.Error);
            string after = Snapshot(parts);
            Check(!delete().Success && count() == 1 && Snapshot(parts) == after, host + " repeated missing deletion mutated remaining data.");
            checks.Add(new { host, kind = "image-delete", badMetadataPreservesOriginal = true, noImplicitRepair = true,
                explicitOrphanRepairVerified = true, deletedMetadataAbsent = true, otherEntryRetained = true, repeatedMissingIsReadOnly = true });
        }

        private static FormulaPayload ReplaceImageCase(object original, FormulaPayload payload, OfficeCore.CustomXMLParts parts,
            Func<FormulaPayload, bool> replace, Func<HostImageReplacementResult> result, Func<int> count,
            Func<object> resolve, Func<object> duplicate, List<object> checks, string host)
        {
            dynamic shape = original;
            shape.Left = 41f; shape.Top = 63f; shape.Rotation = 23f;
            shape.Flip(OfficeCore.MsoFlipCmd.msoFlipHorizontal);
            shape.Flip(OfficeCore.MsoFlipCmd.msoFlipVertical);
            var originalState = HostPictureSnapshot.Capture(original, host == "excel");
            string beforeManifest = Snapshot(parts);
            var updated = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload));
            updated.Latex = "y^3"; updated.Revision = 3; updated.StorageMode = "auto";
            updated.Render.WidthPt = 54; updated.Render.HeightPt = 27;
            using (var state = JsonDocument.Parse("{\"schemaVersion\":1,\"marker\":\"new-source\"}"))
                updated.EditorState = state.RootElement.Clone();
            var matching = parts.SelectByNamespace(Ns);
            try
            {
                var oldPart = matching[1];
                try { oldPart.Delete(); } finally { Marshal.ReleaseComObject(oldPart); }
            }
            finally { Marshal.ReleaseComObject(matching); }
            try
            {
                RejectFaultParts(parts, () => {
                    bool success = replace(updated);
                    Check(!success && result().ErrorCode == "HOST_IMAGE_REPLACE_FAILED" && originalState.Matches(original),
                        host + " metadata preflight changed original image/source.");
                    return success;
                }, count, checks, host + "-replacement");
            }
            finally { var restored = parts.Add(beforeManifest); Marshal.ReleaseComObject(restored); }
            var bad = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(updated));
            bad.Render.Png = "not a PNG";
            Check(!replace(bad) && count() == 2 && originalState.Matches(original) && Snapshot(parts) == beforeManifest,
                host + " invalid PNG changed original/source/manifest.");
            bad = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(updated));
            bad.Render.WidthPt = float.MaxValue;
            Check(!replace(bad) && result().ErrorCode == "HOST_IMAGE_REPLACE_FAILED" && count() == 2 &&
                originalState.Matches(original) && Snapshot(parts) == beforeManifest,
                host + " rejected candidate dimensions left a new picture or changed source/manifest.");
            bad = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(updated));
            bad.FormulaId = FormulaIdHelper.NewId();
            Check(!replace(bad) && count() == 2 && originalState.Matches(original) && Snapshot(parts) == beforeManifest,
                host + " mismatched ID changed original/source/manifest.");
            var copied = duplicate();
            try
            {
                dynamic copy = copied;
                copy.Name = "LSNO_copy_" + Guid.NewGuid().ToString("N");
                copy.AlternativeText = shape.AlternativeText;
                Check(!replace(updated) && count() == 3 && originalState.Matches(original) && Snapshot(parts) == beforeManifest,
                    host + " ambiguous copied ID changed either source/manifest.");
            }
            finally { ((dynamic)copied).Delete(); Marshal.ReleaseComObject(copied); }
            string oldText = shape.AlternativeText;
            try
            {
                shape.AlternativeText = OleFormulaInterop.CreateHostMetadataJson(bad, "image");
                var conflicting = HostPictureSnapshot.Capture(original, host == "excel");
                Check(!replace(updated) && count() == 2 && conflicting.Matches(original) && Snapshot(parts) == beforeManifest,
                    host + " conflicting name/metadata ID was not rejected.");
            }
            finally { shape.AlternativeText = oldText; }
            var decorations = new List<object>();
            try
            {
                for (int index = 0; index < 4; index++)
                {
                    object item = duplicate(); decorations.Add(item);
                    ((dynamic)item).Name = "authored-decoration-" + index;
                    ((dynamic)item).AlternativeText = "";
                }
                Check(replace(updated) && result().Success && result().ActualStorageMode == "image" && count() == 6 && updated.StorageMode == "auto",
                    host + " replacement failed: " + result().ErrorCode + ": " + result().Error);
                var replacement = resolve();
                try
                {
                    dynamic value = replacement;
                    var replacementState = HostPictureSnapshot.Capture(replacement, host == "excel");
                    Check(replacementState.Id != originalState.Id && Math.Abs((float)value.Left - 41f) < 0.02f &&
                        Math.Abs((float)value.Top - 63f) < 0.02f && Math.Abs((float)value.Rotation - 23f) < 0.02f &&
                        Math.Abs((float)value.Width - 54f) < 0.02f && Math.Abs((float)value.Height - 27f) < 0.02f &&
                        value.ZOrderPosition == 1 && (int)value.HorizontalFlip == (int)OfficeCore.MsoTriState.msoTrue &&
                        (int)value.VerticalFlip == (int)OfficeCore.MsoTriState.msoTrue, host + " replacement layout/identity changed.");
                }
                finally { Marshal.ReleaseComObject(replacement); }
            }
            finally { foreach (object item in decorations) { ((dynamic)item).Delete(); Marshal.ReleaseComObject(item); } }
            VerifyUpdatedPicture(resolve(), updated);
            ValidatePayload(Snapshot(parts), updated, host);
            checks.Add(new { host, kind = "image-replacement", metadataFaultPreservesOriginal = true,
                invalidPngPreservesOriginal = true, mismatchedIdRejected = true, copiedIdAmbiguityRejected = true,
                candidateDimensionFaultRolledBack = true, nameMetadataConflictRejected = true, newSourceAndEditorStateVerified = true,
                layeringAcrossMultipleObjectsVerified = true,
                positionRotationFlipsZOrderVerified = true, actualMode = "image", callerAutoPreserved = true });
            return updated;
        }

        private static void VerifyUpdatedPicture(object picture, FormulaPayload expected)
        {
            try
            {
                dynamic shape = picture;
                var metadata = JsonSerializer.Deserialize<FormulaPayload>((string)shape.AlternativeText);
                Check(metadata.FormulaId == expected.FormulaId && metadata.Latex == "y^3" && metadata.Revision == 3 &&
                    metadata.StorageMode == "image" && metadata.EditorState.Value.GetProperty("marker").GetString() == "new-source",
                    "Image retained old AlternativeText/source instead of the update.");
            }
            finally { Marshal.ReleaseComObject(picture); }
        }
    }
}
