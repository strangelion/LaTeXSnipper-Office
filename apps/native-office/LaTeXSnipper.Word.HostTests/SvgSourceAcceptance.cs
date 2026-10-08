using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    // Owned, hidden Word fixtures only. This records import loss, not a SVG reader claim.
    internal static class SvgSourceAcceptance
    {
        private static readonly XNamespace Pkg = "http://schemas.microsoft.com/office/2006/xmlPackage";
        private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
        private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
        private static readonly XNamespace ASvg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
        private static readonly XNamespace Svg = "http://www.w3.org/2000/svg";
        [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();

        private static string Hash(byte[] bytes)
        {
            using var hash = SHA256.Create();
            return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static bool HasFormulaMetadata(XElement svg) => svg.Elements(Svg + "metadata").Any(e =>
            e.Elements().Any(child => child.Name == XName.Get("source", "urn:latexsnipper:formula-source:v1") ||
                child.Name == XName.Get("math", "http://www.w3.org/1998/Math/MathML")));

        internal static int Run(W.Application app, ref W.Document document, WordAdapter adapter, string directory)
        {
            string source = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:fs='urn:latexsnipper:formula-source:v1' " +
                "xmlns:m='http://www.w3.org/1998/Math/MathML' width='24' height='24'><metadata>" +
                "<fs:source format='latex'>x^2</fs:source><m:math><m:mi>x</m:mi></m:math></metadata>" +
                "<rect width='24' height='24' fill='#2563eb'/></svg>";
            string input = Path.Combine(directory, "declared-source.svg");
            string docPath = Path.Combine(directory, "svg-source.docx");
            File.WriteAllText(input, source, new UTF8Encoding(false));
            string originalHash = Hash(File.ReadAllBytes(input));
            uint clipboard = GetClipboardSequenceNumber();
            var checks = new List<object>();
            string error = null;
            W.InlineShape picture = null;
            try
            {
                W.Range insertion = document.Range(0, 0);
                W.InlineShapes shapes = document.InlineShapes;
                try { picture = shapes.AddPicture(input, LinkToFile: false, SaveWithDocument: true, Range: insertion); }
                finally { Marshal.ReleaseComObject(shapes); Marshal.ReleaseComObject(insertion); }
                string part = Check(document, picture, adapter, "inserted-range", checks);
                Marshal.ReleaseComObject(picture); picture = null;
                document.SaveAs2(docPath, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(document); document = null;
                using (var package = ZipFile.OpenRead(docPath))
                {
                    var entry = package.GetEntry(part.TrimStart('/'));
                    if (entry == null) throw new InvalidOperationException("Associated SVG part was not saved.");
                    using var stream = entry.Open();
                    using var bytes = new MemoryStream();
                    stream.CopyTo(bytes);
                    byte[] saved = bytes.ToArray();
                    checks.Add(new { stage = "saved-package", part, originalBytesRetained = Hash(saved) == originalHash,
                        formulaMetadataRetained = HasFormulaMetadata(XElement.Parse(Encoding.UTF8.GetString(saved))),
                        svgHash = Hash(saved), byteLength = saved.Length });
                }
                W.Documents documents = app.Documents;
                try { document = documents.Open(docPath, ReadOnly: false, AddToRecentFiles: false, Visible: false); }
                finally { Marshal.ReleaseComObject(documents); }
                W.InlineShapes reopened = document.InlineShapes;
                try { picture = reopened[1]; }
                finally { Marshal.ReleaseComObject(reopened); }
                Check(document, picture, adapter, "reopened-range", checks);
                if (Hash(File.ReadAllBytes(input)) != originalHash || GetClipboardSequenceNumber() != clipboard)
                    throw new InvalidOperationException("Source file or clipboard changed.");
            }
            catch (Exception exception) { error = exception.ToString(); }
            finally { if (picture != null) Marshal.ReleaseComObject(picture); }
            File.WriteAllText(Path.Combine(directory, "svg-source-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, status = error == null ? "passed" : "failed", wordVersion = app.Version, wordBuild = app.Build,
                inputHash = originalHash, inputMetadataPresent = HasFormulaMetadata(XElement.Parse(source)), checks,
                sourceFileUnchanged = Hash(File.ReadAllBytes(input)) == originalHash,
                clipboardUnchanged = GetClipboardSequenceNumber() == clipboard, error,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine(error ?? "SVG import loss recorded; PNG fallback and selection guards passed.");
            return error == null ? 0 : 1;
        }

        private static string Check(W.Document document, W.InlineShape picture, WordAdapter adapter, string stage, List<object> checks)
        {
            W.Range range = picture.Range;
            W.Range content = document.Content;
            W.Selection selection = null;
            W.Application application = document.Application;
            try
            {
                range.Select();
                string text = content.Text;
                bool saved = document.Saved;
                float width = picture.Width, height = picture.Height;
                string xml = range.WordOpenXML;
                var package = XDocument.Parse(xml);
                var documentPart = package.Root.Elements(Pkg + "part").Single(p => (string)p.Attribute(Pkg + "name") == "/word/document.xml");
                var blip = documentPart.Descendants(A + "blip").Single();
                var svg = blip.Descendants(ASvg + "svgBlip").Single();
                var rels = package.Root.Elements(Pkg + "part").Single(p => (string)p.Attribute(Pkg + "name") == "/word/_rels/document.xml.rels");
                string part = "/word/" + (string)rels.Descendants(Rel + "Relationship").Single(e => (string)e.Attribute("Id") == (string)svg.Attribute(R + "embed")).Attribute("Target");
                var svgPart = package.Root.Elements(Pkg + "part").Single(p => (string)p.Attribute(Pkg + "name") == part);
                if ((string)svgPart.Attribute(Pkg + "contentType") != "image/svg+xml")
                    throw new InvalidOperationException("Associated SVG has an unexpected content type.");
                var data = svgPart.Element(Pkg + "xmlData");
                XElement root = data != null ? data.Elements().Single() :
                    XElement.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(svgPart.Element(Pkg + "binaryData").Value)));
                if (root.Name != Svg + "svg") throw new InvalidOperationException("Associated part is not SVG.");
                if (WordPngSourceReader.Read(xml) != null || adapter.ReadSelectedPngSource() != null)
                    throw new InvalidOperationException("SVG fallback was accepted as a PNG source.");
                selection = application.Selection;
                if (content.Text != text || document.Saved != saved || picture.Width != width || picture.Height != height ||
                    selection.Start != range.Start || selection.End != range.End)
                    throw new InvalidOperationException("Source inspection changed the document or selection.");
                checks.Add(new { stage, shapeType = (int)picture.Type, part, storage = data != null ? "xmlData" : "binaryData",
                    formulaMetadataRetained = HasFormulaMetadata(root), pngFallbackRejected = true,
                    textGeometrySelectionAndSavedStateUnchanged = true });
                return part;
            }
            finally
            {
                if (selection != null) Marshal.ReleaseComObject(selection);
                Marshal.ReleaseComObject(application);
                Marshal.ReleaseComObject(content);
                Marshal.ReleaseComObject(range);
            }
        }
    }
}
