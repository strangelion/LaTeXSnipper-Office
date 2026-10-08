#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>Read one Word-associated SVG for identity only; never render or execute it.</summary>
public static class WordSvgSourceBinding
{
    public const int MaxSvgBytes = 4 * 1024 * 1024;
    private const int MaxSourceChars = 256 * 1024;
    private static readonly XNamespace Pkg = "http://schemas.microsoft.com/office/2006/xmlPackage";
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace ASvg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

    public static WordSvgBinding? Create(FormulaPayload payload, string? scopedXml)
    {
        if (!SourceWithinBudget(payload)) return null;
        string? carrier = CarrierHash(scopedXml);
        if (carrier == null) return null;
        return new WordSvgBinding {
            OriginalSvgSha256 = SourceHash.Sha256Hex(payload.Render!.Svg!),
            WordSvgSha256 = carrier,
            SourceSha256 = SourceFingerprint(payload),
        };
    }

    public static bool Matches(FormulaPayload payload, string? scopedXml)
    {
        var binding = payload.Source?.WordSvgBinding;
        if (binding == null || binding.Version != 1 || !SourceWithinBudget(payload) ||
            binding.WordSvgSha256 == null || !Regex.IsMatch(binding.WordSvgSha256, "\\A[0-9a-f]{64}\\z")) return false;
        return binding.OriginalSvgSha256 == SourceHash.Sha256Hex(payload.Render!.Svg!) &&
            binding.SourceSha256 == SourceFingerprint(payload) &&
            binding.WordSvgSha256 == CarrierHash(scopedXml);
    }

    private static bool SourceWithinBudget(FormulaPayload payload) =>
        payload.Render?.Svg != null && payload.Render.Svg.Length <= MaxSvgBytes &&
        Encoding.UTF8.GetByteCount(payload.Render.Svg) <= MaxSvgBytes &&
        payload.Latex != null && payload.Latex.Length <= MaxSourceChars &&
        payload.Omml != null && payload.Omml.Length <= MaxSourceChars &&
        (payload.ContentKind?.Length ?? 0) <= 128 &&
        (!payload.EditorState.HasValue || payload.EditorState.Value.GetRawText().Length <= MaxSourceChars);

    private static string SourceFingerprint(FormulaPayload payload) => SourceHash.Sha256Hex(
        JsonSerializer.Serialize(new { payload.Latex, payload.Omml, payload.ContentKind, payload.EditorState }));

    private static XDocument Parse(string xml, int maxChars)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
            MaxCharactersInDocument = maxChars };
        using (var input = new StringReader(xml))
        using (var reader = XmlReader.Create(input, settings))
        {
            int events = 0;
            while (reader.Read()) if (reader.Depth > 64 || reader.AttributeCount > 64 || ++events > 100000)
                throw new XmlException("SVG identity XML budget exceeded.");
        }
        using (var input = new StringReader(xml))
        using (var reader = XmlReader.Create(input, settings))
            return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
    }

    public static string? CarrierHash(string? scopedXml)
    {
        if (scopedXml == null || scopedXml.Length == 0 || scopedXml.Length > WordPngSourceReader.MaxXmlChars) return null;
        try
        {
            var root = Parse(scopedXml, WordPngSourceReader.MaxXmlChars).Root;
            if (root == null || root.Name != Pkg + "package") return null;
            var parts = root.Elements(Pkg + "part").ToArray();
            if (parts.Length > 128 || parts.GroupBy(p => (string?)p.Attribute(Pkg + "name")).Any(g => g.Count() != 1)) return null;
            var document = parts.SingleOrDefault(p => (string?)p.Attribute(Pkg + "name") == "/word/document.xml")?.Element(Pkg + "xmlData");
            if (document == null || document.Descendants(XName.Get("OLEObject", "urn:schemas-microsoft-com:office:office")).Any()) return null;
            var blips = document.Descendants(A + "blip").ToArray();
            if (blips.Length != 1 || blips[0].Attribute(R + "link") != null) return null;
            var extensions = blips[0].Descendants().Where(e => e.Name.LocalName == "svgBlip").ToArray();
            if (extensions.Length != 1 || extensions[0].Name != ASvg + "svgBlip" || extensions[0].Attribute(R + "link") != null) return null;
            var ext = extensions[0].Parent;
            if (ext?.Name != A + "ext" || (string?)ext.Attribute("uri") != "{96DAC541-7B7A-43D3-8B79-37D633B846F1}" ||
                ext.Parent?.Name != A + "extLst" || ext.Parent.Parent != blips[0]) return null;
            string? id = (string?)extensions[0].Attribute(R + "embed");
            if (id == null || id.Length == 0) return null;
            var links = parts.SingleOrDefault(p => (string?)p.Attribute(Pkg + "name") == "/word/_rels/document.xml.rels")
                ?.Element(Pkg + "xmlData")?.Element(Rel + "Relationships")?.Elements(Rel + "Relationship")
                .Where(e => (string?)e.Attribute("Id") == id).ToArray();
            if (links == null || links.Length != 1 || links[0].Attribute("TargetMode") != null ||
                (string?)links[0].Attribute("Type") != R.NamespaceName + "/image") return null;
            string? target = (string?)links[0].Attribute("Target");
            if (target == null || !Regex.IsMatch(target, @"\Amedia/[A-Za-z0-9_.-]+\.svg\z", RegexOptions.IgnoreCase)) return null;
            var part = parts.SingleOrDefault(p => (string?)p.Attribute(Pkg + "name") == "/word/" + target);
            if ((string?)part?.Attribute(Pkg + "contentType") != "image/svg+xml") return null;
            var data = part!.Elements().ToArray();
            if (data.Length != 1) return null;
            XElement? svg;
            if (data[0].Name == Pkg + "xmlData")
                svg = data[0].Elements().SingleOrDefault();
            else if (data[0].Name == Pkg + "binaryData" && !data[0].HasElements)
            {
                string encoded = Regex.Replace(data[0].Value, "[ \t\r\n]", "");
                if (!StrictBase64.TryDecode(encoded, out byte[] bytes, MaxSvgBytes)) return null;
                svg = Parse(new UTF8Encoding(false, true).GetString(bytes), MaxSvgBytes).Root;
            }
            else return null;
            if (svg == null || svg.Name != XName.Get("svg", "http://www.w3.org/2000/svg")) return null;
            string materialized = svg.ToString(SaveOptions.DisableFormatting);
            if (Encoding.UTF8.GetByteCount(materialized) > MaxSvgBytes) return null;
            // This hashes the materialized Word carrier, NOT original SVG bytes.
            return SourceHash.Sha256Hex(materialized);
        }
        catch (Exception e) when (e is XmlException || e is InvalidOperationException || e is ArgumentException || e is FormatException)
        { return null; }
    }
}
