using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class PngSourceAcceptance
    {
        internal static int Viewer()
        {
            var request = new VstoReadPngSource { RequestId = "fixture-read", SessionId = "fixture-session", DocumentContextId = "fixture-document", CarrierSha256 = new string('a', 64) };
            var result = new DesktopPngSourceResult { RequestId = request.RequestId, SessionId = request.SessionId, DocumentContextId = request.DocumentContextId, CarrierSha256 = request.CarrierSha256, Success = true, Conflict = true,
                Candidates = new List<FormulaSourceCandidate> {
                    new FormulaSourceCandidate { Format = "latex", Source = "\\frac{1}{2}+x^2", Provenance = "tEXt / latex / 100..140" },
                    new FormulaSourceCandidate { Format = "latex", Source = "\\frac{1}{2}+y^2", Provenance = "iTXt / latex / 140..180" },
                } };
            Application.EnableVisualStyles();
            using var dialog = new LaTeXSnipper.Word.PngSourceDialog(request);
            dialog.Text += " - TEST FIXTURE";
            result.CarrierSha256 = new string('b', 64);
            dialog.Complete(result);
            var list = dialog.Controls.OfType<TableLayoutPanel>().Single().Controls.OfType<ListBox>().Single();
            if (list.Items.Count != 0) throw new InvalidOperationException("Mismatched reply was accepted.");
            result.CarrierSha256 = request.CarrierSha256;
            dialog.Complete(result);
            if (list.Items.Count != 2 || list.SelectedIndex != -1) throw new InvalidOperationException("Conflicting sources were auto-selected.");
            dialog.Complete(result);
            if (list.Items.Count != 2) throw new InvalidOperationException("Duplicate reply was accepted.");
            using (var cancelled = new LaTeXSnipper.Word.PngSourceDialog(request))
            {
                cancelled.Fail("PNG_SOURCE_TIMEOUT"); cancelled.Complete(result);
                var cancelledList = cancelled.Controls.OfType<TableLayoutPanel>().Single().Controls.OfType<ListBox>().Single();
                if (cancelledList.Items.Count != 0) throw new InvalidOperationException("Late reply after timeout was accepted.");
            }
            dialog.ShowDialog();
            Console.WriteLine("PNG viewer correlation, conflict and timeout checks passed.");
            return 0;
        }
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
        private static string Hash(byte[] bytes) { using var hash = SHA256.Create(); return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        private static uint Crc(byte[] bytes)
        {
            uint crc = uint.MaxValue;
            foreach (byte b in bytes) { crc ^= b; for (int i = 0; i < 8; i++) crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320u : 0); }
            return ~crc;
        }
        private static byte[] Png()
        {
            using var raw = new MemoryStream();
            using (var bitmap = new Bitmap(16, 16)) { using var graphics = Graphics.FromImage(bitmap); graphics.Clear(Color.White); bitmap.Save(raw, System.Drawing.Imaging.ImageFormat.Png); }
            byte[] image = raw.ToArray();
            byte[] field = Encoding.ASCII.GetBytes("latex\0\\frac{1}{2}+x^2");
            byte[] body = Encoding.ASCII.GetBytes("tEXt").Concat(field).ToArray();
            using var output = new MemoryStream();
            output.Write(image, 0, image.Length - 12);
            byte[] length = BitConverter.GetBytes(field.Length); Array.Reverse(length); output.Write(length, 0, 4);
            output.Write(body, 0, body.Length);
            byte[] crc = BitConverter.GetBytes(Crc(body)); Array.Reverse(crc); output.Write(crc, 0, 4);
            output.Write(image, image.Length - 12, 12);
            return output.ToArray();
        }

        internal static int Run(W.Application app, ref W.Document document, WordAdapter adapter, string directory)
        {
            uint clipboard = GetClipboardSequenceNumber();
            string error = null;
            var checks = new List<object>();
            string pngPath = Path.Combine(directory, "declared-source.png");
            byte[] original = Png();
            File.WriteAllBytes(pngPath, original);
            string expected = Hash(original);
            string docPath = Path.Combine(directory, "png-source.docx");
            try
            {
                W.Range insertion = document.Range(0, 0);
                W.InlineShape picture = document.InlineShapes.AddPicture(pngPath, LinkToFile: false, SaveWithDocument: true, Range: insertion);
                Marshal.ReleaseComObject(insertion);
                Check(document, picture, adapter, expected, checks);
                Marshal.ReleaseComObject(picture);
                document.SaveAs2(docPath, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(document); document = null;
                document = app.Documents.Open(docPath, ReadOnly: false, AddToRecentFiles: false);
                picture = document.InlineShapes[1];
                Check(document, picture, adapter, expected, checks);
                Marshal.ReleaseComObject(picture);
                W.Range text = document.Content;
                text.Select();
                if (adapter.ReadSelectedPngSource() != null) throw new InvalidOperationException("Broad text selection was accepted.");
                Marshal.ReleaseComObject(text);
                if (Hash(File.ReadAllBytes(pngPath)) != expected || GetClipboardSequenceNumber() != clipboard)
                    throw new InvalidOperationException("Source image or clipboard changed.");
            }
            catch (Exception exception) { error = exception.ToString(); }
            File.WriteAllText(Path.Combine(directory, "png-source-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, status = error == null ? "passed" : "failed", checks,
                pngHash = expected, sourceImageUnchanged = Hash(File.ReadAllBytes(pngPath)) == expected,
                clipboardUnchanged = GetClipboardSequenceNumber() == clipboard, error,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine(error ?? "PNG source selection/save-reopen read passed.");
            return error == null ? 0 : 1;
        }

        private static void Check(W.Document document, W.InlineShape picture, WordAdapter adapter, string expected, List<object> checks)
        {
            W.Range range = picture.Range;
            range.Select();
            string text = document.Content.Text;
            float width = picture.Width, height = picture.Height;
            var result = adapter.ReadSelectedPngSource();
            if (result == null || result.CarrierSha256 != expected || Hash(Convert.FromBase64String(result.PngBase64)) != expected)
                throw new InvalidOperationException("Selected PNG did not preserve exact source bytes.");
            if (document.Content.Text != text || picture.Width != width || picture.Height != height ||
                document.Application.Selection.Start != range.Start || document.Application.Selection.End != range.End)
                throw new InvalidOperationException("Source read changed text, dimensions or selection.");
            checks.Add(new { originalBytes = true, documentContextBound = result.DocumentContextId == adapter.GetCurrentContextId(), textGeometrySelectionUnchanged = true });
            Marshal.ReleaseComObject(range);
        }
    }
}
