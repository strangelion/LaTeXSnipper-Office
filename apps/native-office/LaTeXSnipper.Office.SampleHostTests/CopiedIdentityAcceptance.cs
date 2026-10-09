using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.Excel.Host;
using LaTeXSnipper.PowerPoint.Host;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using OfficeCore = Microsoft.Office.Core;
using InteropExcel = Microsoft.Office.Interop.Excel;
using Ppt = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.Office.SampleHostTests
{
    internal static class CopiedIdentityAcceptance
    {
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
        private const string Ns = "urn:latexsnipper:office:objects:v3";
        private static void Check(bool valid, string message) { if (!valid) throw new InvalidOperationException(message); }
        private static FormulaPayload Payload()
        {
            using (var picture = new Bitmap(24, 12))
            using (var graphics = Graphics.FromImage(picture))
            using (var bytes = new MemoryStream())
            {
                graphics.Clear(Color.White); graphics.DrawLine(Pens.Black, 2, 6, 21, 6); picture.Save(bytes, ImageFormat.Png);
                var value = new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = "x^2", Revision = 8, StorageMode = "image",
                    Render = new RenderData { Png = Convert.ToBase64String(bytes.ToArray()), WidthPt = 36, HeightPt = 18 } };
                using (var state = JsonDocument.Parse("{\"schemaVersion\":1,\"marker\":\"copied-source\"}")) value.EditorState = state.RootElement.Clone();
                return value;
            }
        }
        public static int Run(string directory)
        {
            Directory.CreateDirectory(directory); var checks = new List<object>(); string error = null;
            uint clipboard = GetClipboardSequenceNumber();
            try { ExcelCase(directory, checks); PowerPointCase(directory, checks); }
            catch (Exception failure) { error = failure.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "copied-identity-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, checks, error, status = error == null ? "passed" : "failed", clipboardUnchanged = clipboard == GetClipboardSequenceNumber(),
                pipeVerified = false, scope = "Hidden direct adapters, actual same-container PNG Duplicate and authored cross-document thin-source transfer. No OLE or installed add-in claim."
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }
        private static FormulaPayload Compact(object value)
            => JsonSerializer.Deserialize<FormulaPayload>((string)((dynamic)value).AlternativeText);

        private static void Transfer(object picture, FormulaPayload payload, OfficeCore.CustomXMLParts parts,
            Func<object, FormulaPayload, FormulaPayload> reconcile, List<object> checks, string host)
        {
            ((dynamic)picture).AlternativeText = OleFormulaInterop.CreateHostMetadataJson(payload, "image");
            var thin = Compact(picture);
            Check(thin.Render == null, "Authored transfer was not thin-source metadata.");
            var adopted = reconcile(picture, thin);
            var entries = FormulaDocumentManifest.ReadAllEntries(parts);
            Check(adopted.FormulaId != payload.FormulaId && FormulaIdHelper.IsCanonical(adopted.FormulaId) && entries.Count == 1 &&
                entries[adopted.FormulaId].Latex == payload.Latex && adopted.Render == null &&
                adopted.EditorState.Value.GetProperty("marker").GetString() == "copied-source" && adopted.Host == host &&
                adopted.DocumentContext.StartsWith(host + ":", StringComparison.Ordinal), host + " authored transfer failed or guessed absent render data.");
            checks.Add(new { host, kind = "authored-cross-document-transfer", newDocumentIdAndSourceCommitted = true,
                sourceStateRetained = true, missingBinaryNotFabricated = true });
        }

        private static FormulaPayload Adopt(object original, object copied, FormulaPayload payload, OfficeCore.CustomXMLParts parts,
            Func<object, FormulaPayload, FormulaPayload> reconcile, List<object> checks, string host)
        {
            var source = HostPictureSnapshot.Capture(original, host == "excel");
            var copy = HostPictureSnapshot.Capture(copied, host == "excel");
            var old = Compact(copied);
            var matching = parts.SelectByNamespace(Ns); string xml;
            try { var part = matching[1]; try { xml = part.XML; part.Delete(); } finally { Marshal.ReleaseComObject(part); } }
            finally { Marshal.ReleaseComObject(matching); }
            try
            {
                var wrong = parts.Add($"<lsno:wrong xmlns:lsno='{Ns}'/>");
                try
                {
                    bool rejected = false;
                    try { reconcile(copied, old); } catch (HostIdentityReconciliationException) { rejected = true; }
                    Check(rejected && source.Matches(original) && copy.Matches(copied), host + " bad metadata changed either identity.");
                }
                finally { wrong.Delete(); Marshal.ReleaseComObject(wrong); }
            }
            finally { var restored = parts.Add(xml); Marshal.ReleaseComObject(restored); }
            var adopted = reconcile(copied, old);
            var entries = FormulaDocumentManifest.ReadAllEntries(parts);
            Check(adopted.FormulaId != payload.FormulaId && FormulaIdHelper.IsCanonical(adopted.FormulaId) && adopted.Revision == 0 &&
                adopted.Render.Png == payload.Render.Png && adopted.EditorState.Value.GetProperty("marker").GetString() == "copied-source" &&
                entries.Count == 2 && entries[payload.FormulaId].Revision == 8 && entries[payload.FormulaId].Render.Png == payload.Render.Png &&
                entries[adopted.FormulaId].Render.Png == payload.Render.Png && old.FormulaId == payload.FormulaId && old.Render == null &&
                source.Matches(original) && copy.MatchesLayout(copied), host + " identity adoption lost source, render, original or layout.");
            var stable = reconcile(copied, Compact(copied));
            Check(stable.FormulaId == adopted.FormulaId && FormulaDocumentManifest.ReadAllEntries(parts).Count == 2,
                host + " repeated read generated another identity.");
            checks.Add(new { host, kind = "actual-duplicate", originalUnchanged = true, copiedHostIdUnchanged = true,
                newIdAndManifestVerified = true, completeMatchedSourceAndRenderRetained = true, stableSecondRead = true, badManifestIsNonMutating = true });
            return adopted;
        }

        private static void ExcelCase(string directory, List<object> checks)
        {
            InteropExcel.Application app = null; InteropExcel.Workbook book = null; InteropExcel.Worksheet sheet = null;
            OfficeCore.CustomXMLParts parts = null; InteropExcel.Shape original = null, copied = null;
            try
            {
                app = new InteropExcel.Application { Visible = false, DisplayAlerts = false }; book = app.Workbooks.Add();
                sheet = (InteropExcel.Worksheet)book.Worksheets[1]; var adapter = new ExcelAdapter(app); var payload = Payload();
                Check(adapter.InsertFormula(payload, InsertMode.Inline).Success, "Excel fixture insertion failed.");
                original = sheet.Shapes.Item("LSNO_" + payload.FormulaId);
                object returned = original.Duplicate();
                try { copied = sheet.Shapes.Item(sheet.Shapes.Count); } finally { Marshal.ReleaseComObject(returned); }
                parts = book.CustomXMLParts;
                var adopted = Adopt(original, copied, payload, parts, (value, source) => adapter.ReconcileCopiedFormulaIdentity(value, source, null), checks, "excel");
                Check(ManifestDiagnostics.ValidateExcel(book).IsConsistent && !app.Visible, "Excel adopted inventory inconsistent or visible.");
                string transferPath = Path.Combine(directory, "transfer-excel.png"); File.WriteAllBytes(transferPath, Convert.FromBase64String(payload.Render.Png));
                var otherBook = app.Workbooks.Add(); var otherSheet = (InteropExcel.Worksheet)otherBook.Worksheets[1];
                var transfer = otherSheet.Shapes.AddPicture(transferPath, OfficeCore.MsoTriState.msoFalse, OfficeCore.MsoTriState.msoTrue, 0, 0, 36, 18);
                var otherParts = otherBook.CustomXMLParts;
                try { Transfer(transfer, payload, otherParts, (value, source) => adapter.ReconcileCopiedFormulaIdentity(value, source, null), checks, "excel"); }
                finally { Marshal.ReleaseComObject(otherParts); Marshal.ReleaseComObject(transfer); Marshal.ReleaseComObject(otherSheet); otherBook.Close(false); Marshal.ReleaseComObject(otherBook); }
                Marshal.ReleaseComObject(original); original = null; Marshal.ReleaseComObject(copied); copied = null;
                Marshal.ReleaseComObject(parts); parts = null; Marshal.ReleaseComObject(sheet); sheet = null;
                string path = Path.Combine(directory, "copied-excel.xlsx"); book.SaveAs(path, InteropExcel.XlFileFormat.xlOpenXMLWorkbook);
                book.Close(false); Marshal.ReleaseComObject(book); book = app.Workbooks.Open(path, ReadOnly: true);
                sheet = (InteropExcel.Worksheet)book.Worksheets[1]; parts = book.CustomXMLParts;
                Check(FormulaDocumentManifest.ReadAllEntries(parts).ContainsKey(adopted.FormulaId) && sheet.Shapes.Count == 2 &&
                    ManifestDiagnostics.ValidateExcel(book).IsConsistent, "Excel copy changed after reopen.");
                var readable = sheet.Shapes.Item("LSNO_" + adopted.FormulaId);
                try { Check(adapter.ReconcileCopiedFormulaIdentity(readable, Compact(readable), null).FormulaId == adopted.FormulaId,
                    "Read-only unique Excel source could not be read."); }
                finally { Marshal.ReleaseComObject(readable); }
                checks.Add(new { host = "excel", kind = "save-reopen", independentlyAddressable = true, version = app.Version });
            }
            finally
            {
                if (copied != null) Marshal.ReleaseComObject(copied); if (original != null) Marshal.ReleaseComObject(original);
                if (parts != null) Marshal.ReleaseComObject(parts); if (sheet != null) Marshal.ReleaseComObject(sheet);
                if (book != null) { book.Close(false); Marshal.ReleaseComObject(book); } if (app != null) { app.Quit(); Marshal.ReleaseComObject(app); }
            }
        }

        private static void PowerPointCase(string directory, List<object> checks)
        {
            Ppt.Application app = null; Ppt.Presentation presentation = null; Ppt.Slide slide = null;
            OfficeCore.CustomXMLParts parts = null; Ppt.Shape original = null, copied = null;
            try
            {
                app = new Ppt.Application(); presentation = app.Presentations.Add(OfficeCore.MsoTriState.msoFalse);
                slide = presentation.Slides.Add(1, Ppt.PpSlideLayout.ppLayoutBlank); var payload = Payload();
                var adapter = new PowerPointAdapter(app, targetPresentation: presentation, targetSlide: slide);
                Check(adapter.InsertFormula(payload, InsertMode.Inline).Success, "PowerPoint fixture insertion failed.");
                original = slide.Shapes["LSNO_" + payload.FormulaId]; var range = original.Duplicate();
                try { copied = range[1]; } finally { Marshal.ReleaseComObject(range); }
                parts = presentation.CustomXMLParts;
                var adopted = Adopt(original, copied, payload, parts, (value, source) => adapter.ReconcileCopiedFormulaIdentity(value, source, null), checks, "powerpoint");
                Check(ManifestDiagnostics.ValidatePowerPoint(presentation).IsConsistent && app.Visible != OfficeCore.MsoTriState.msoTrue,
                    "PowerPoint adopted inventory inconsistent or visible.");
                string transferPath = Path.Combine(directory, "transfer-powerpoint.png"); File.WriteAllBytes(transferPath, Convert.FromBase64String(payload.Render.Png));
                var other = app.Presentations.Add(OfficeCore.MsoTriState.msoFalse); var otherSlide = other.Slides.Add(1, Ppt.PpSlideLayout.ppLayoutBlank);
                var transfer = otherSlide.Shapes.AddPicture(transferPath, OfficeCore.MsoTriState.msoFalse, OfficeCore.MsoTriState.msoTrue, 0, 0, 36, 18);
                var otherParts = other.CustomXMLParts;
                try { Transfer(transfer, payload, otherParts, (value, source) => adapter.ReconcileCopiedFormulaIdentity(value, source, null), checks, "powerpoint"); }
                finally { Marshal.ReleaseComObject(otherParts); Marshal.ReleaseComObject(transfer); Marshal.ReleaseComObject(otherSlide); other.Close(); Marshal.ReleaseComObject(other); }
                Marshal.ReleaseComObject(original); original = null; Marshal.ReleaseComObject(copied); copied = null;
                Marshal.ReleaseComObject(parts); parts = null; Marshal.ReleaseComObject(slide); slide = null;
                string path = Path.Combine(directory, "copied-powerpoint.pptx"); presentation.SaveAs(path, Ppt.PpSaveAsFileType.ppSaveAsOpenXMLPresentation);
                presentation.Close(); Marshal.ReleaseComObject(presentation);
                presentation = app.Presentations.Open(path, ReadOnly: OfficeCore.MsoTriState.msoTrue, WithWindow: OfficeCore.MsoTriState.msoFalse);
                slide = presentation.Slides[1]; parts = presentation.CustomXMLParts;
                Check(FormulaDocumentManifest.ReadAllEntries(parts).ContainsKey(adopted.FormulaId) && slide.Shapes.Count == 2 &&
                    ManifestDiagnostics.ValidatePowerPoint(presentation).IsConsistent, "PowerPoint copy changed after reopen.");
                var readable = slide.Shapes["LSNO_" + adopted.FormulaId];
                try { Check(adapter.ReconcileCopiedFormulaIdentity(readable, Compact(readable), null).FormulaId == adopted.FormulaId,
                    "Read-only unique PowerPoint source could not be read."); }
                finally { Marshal.ReleaseComObject(readable); }
                checks.Add(new { host = "powerpoint", kind = "save-reopen", independentlyAddressable = true, version = app.Version });
            }
            finally
            {
                if (copied != null) Marshal.ReleaseComObject(copied); if (original != null) Marshal.ReleaseComObject(original);
                if (parts != null) Marshal.ReleaseComObject(parts); if (slide != null) Marshal.ReleaseComObject(slide);
                if (presentation != null) { presentation.Close(); Marshal.ReleaseComObject(presentation); } if (app != null) { app.Quit(); Marshal.ReleaseComObject(app); }
            }
        }
    }
}
