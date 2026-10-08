#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>Read only one embedded DrawingML PNG from a scoped Word Flat OPC range.</summary>
public static class WordPngSourceReader
{
    public const int MaxPngBytes = 4 * 1024 * 1024;
    public const int MaxXmlChars = 16 * 1024 * 1024;

    public static byte[]? Read(string? xml)
    {
        if (xml == null || xml.Length == 0 || xml.Length > MaxXmlChars) return null;
        try
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null, MaxCharactersInDocument = MaxXmlChars };
            using (var input = new StringReader(xml))
            using (var reader = XmlReader.Create(input, settings))
            {
                int events = 0;
                while (reader.Read()) if (reader.Depth > 64 || ++events > 100000) return null;
            }
            XDocument package;
            using (var input = new StringReader(xml))
            using (var reader = XmlReader.Create(input, settings)) package = XDocument.Load(reader);
            XNamespace pkg = "http://schemas.microsoft.com/office/2006/xmlPackage";
            XNamespace a = "http://schemas.openxmlformats.org/drawingml/2006/main";
            XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            XNamespace rel = "http://schemas.openxmlformats.org/package/2006/relationships";
            XNamespace o = "urn:schemas-microsoft-com:office:office";
            var root = package.Root;
            if (root == null || root.Name != pkg + "package") return null;
            var parts = root.Elements(pkg + "part").ToArray();
            if (parts.Length > 128 || parts.GroupBy(p => (string?)p.Attribute(pkg + "name")).Any(g => g.Count() != 1)) return null;
            var document = parts.SingleOrDefault(p => (string?)p.Attribute(pkg + "name") == "/word/document.xml")?.Element(pkg + "xmlData");
            if (document == null || document.Descendants(o + "OLEObject").Any()) return null;
            var blips = document.Descendants(a + "blip").ToArray();
            if (blips.Length != 1 || blips[0].Attribute(r + "link") != null) return null;
            string? id = (string?)blips[0].Attribute(r + "embed");
            if (id == null || id.Length == 0) return null;
            var links = parts.SingleOrDefault(p => (string?)p.Attribute(pkg + "name") == "/word/_rels/document.xml.rels")
                ?.Element(pkg + "xmlData")?.Element(rel + "Relationships")?.Elements(rel + "Relationship")
                .Where(p => (string?)p.Attribute("Id") == id).ToArray();
            if (links == null || links.Length != 1 || links[0].Attribute("TargetMode") != null ||
                (string?)links[0].Attribute("Type") != r.NamespaceName + "/image") return null;
            string? target = (string?)links[0].Attribute("Target");
            if (target == null || !Regex.IsMatch(target, @"\Amedia/[A-Za-z0-9_.-]+\.png\z", RegexOptions.IgnoreCase)) return null;
            var part = parts.SingleOrDefault(p => (string?)p.Attribute(pkg + "name") == "/word/" + target);
            if ((string?)part?.Attribute(pkg + "contentType") != "image/png") return null;
            var data = part?.Elements(pkg + "binaryData").ToArray();
            if (data == null || data.Length != 1 || data[0].HasElements) return null;
            int limit = ((MaxPngBytes + 2) / 3) * 4;
            var compact = new StringBuilder();
            foreach (char ch in data[0].Value)
            {
                if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') continue;
                if (compact.Length >= limit) return null;
                compact.Append(ch);
            }
            if (!StrictBase64.TryDecode(compact.ToString(), out byte[] bytes, MaxPngBytes)) return null;
            byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
            return bytes.Length >= 8 && bytes.Take(8).SequenceEqual(signature) ? bytes : null;
        }
        catch (Exception e) when (e is XmlException || e is InvalidOperationException || e is ArgumentException || e is FormatException)
        { return null; }
    }
}
