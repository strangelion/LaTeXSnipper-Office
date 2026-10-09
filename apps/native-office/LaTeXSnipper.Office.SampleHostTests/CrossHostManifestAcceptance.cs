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
            Check(stored.FormulaId == expected.FormulaId && stored.Latex == expected.Latex && stored.StorageMode == "image" &&
                stored.Render.Png == expected.Render.Png && (string)entry.Element("locator").Attribute("host") == host,
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

        public static int Run(string directory)
        {
            Directory.CreateDirectory(directory);
            var checks = new List<object>(); string error = null;
            uint clipboard = GetClipboardSequenceNumber();
            try { ExcelCase(directory, checks); PowerPointCase(directory, checks); }
            catch (Exception failure) { error = failure.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "cross-host-manifest-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, checks, error, status = error == null ? "passed" : "failed",
                clipboardUnchanged = GetClipboardSequenceNumber() == clipboard, pipeVerified = false,
                scope = "Authored PNG image insertion, metadata faults and save/reopen. No OLE activation, installed add-in, UI or general format fidelity claim."
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }

        private static void ExcelCase(string directory, List<object> checks)
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
                string snapshot = Snapshot(parts); ValidatePayload(snapshot, payload, "excel");
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
                Check(Snapshot(parts) == snapshot && sheet.Shapes.Count == 2 && originalText == "keep source text",
                    "Excel persisted shape, source or manifest changed.");
                checks.Add(new { host = "excel", kind = "image-success", actualMode = result.ActualStorageMode,
                    fullPayloadVerified = true, priorEntryPreserved = true, objectCount = 2,
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

        private static void PowerPointCase(string directory, List<object> checks)
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
                string snapshot = Snapshot(parts); ValidatePayload(snapshot, payload, "powerpoint");
                ValidatePayload(snapshot, secondPayload, "powerpoint");
                Marshal.ReleaseComObject(parts); parts = null; Marshal.ReleaseComObject(slide); slide = null;
                string path = Path.Combine(directory, "manifest-powerpoint.pptx");
                presentation.SaveAs(path, Ppt.PpSaveAsFileType.ppSaveAsOpenXMLPresentation);
                presentation.Close(); Marshal.ReleaseComObject(presentation); presentation = null;
                presentation = app.Presentations.Open(path, ReadOnly: OfficeCore.MsoTriState.msoTrue, WithWindow: OfficeCore.MsoTriState.msoFalse);
                slide = presentation.Slides[1]; parts = presentation.CustomXMLParts;
                Check(Snapshot(parts) == snapshot && slide.Shapes.Count == 2 && app.Visible != OfficeCore.MsoTriState.msoTrue,
                    "PowerPoint persisted shape/manifest changed or test became visible.");
                checks.Add(new { host = "powerpoint", kind = "image-success", actualMode = result.ActualStorageMode,
                    fullPayloadVerified = true, priorEntryPreserved = true, objectCount = 2,
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
    }
}
