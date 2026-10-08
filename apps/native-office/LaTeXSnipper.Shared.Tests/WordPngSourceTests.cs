using System;
using System.Collections.Generic;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class WordPngSourceTests
    {
        private const string Signature = "iVBORw0KGgo=";
        internal static string Package(string binary = Signature, string target = "media/image1.png", string mode = "", string extra = "") =>
            "<pkg:package xmlns:pkg='http://schemas.microsoft.com/office/2006/xmlPackage'>" +
            "<pkg:part pkg:name='/word/document.xml'><pkg:xmlData><w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:a='http://schemas.openxmlformats.org/drawingml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><w:body><a:blip r:embed='rId1'/>" + extra + "</w:body></w:document></pkg:xmlData></pkg:part>" +
            "<pkg:part pkg:name='/word/_rels/document.xml.rels'><pkg:xmlData><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' Target='" + target + "' " + mode + "/></Relationships></pkg:xmlData></pkg:part>" +
            "<pkg:part pkg:name='/word/media/image1.png' pkg:contentType='image/png'><pkg:binaryData>" + binary + "</pkg:binaryData></pkg:part></pkg:package>";

        internal static int Run()
        {
            int failures = 0;
            Action<bool, string> check = (ok, message) => { if (!ok) { Console.Error.WriteLine("FAIL " + message); failures++; } };
            check(WordPngSourceReader.Read(Package())?.Length == 8, "exact associated PNG bytes");
            check(WordPngSourceReader.Read(Package(" \n" + Signature + "\t"))?.Length == 8, "Word Base64 line wrapping");
            string svgPicture = Package().Replace("<a:blip r:embed='rId1'/>",
                "<a:blip r:embed='rId1'><a:extLst><a:ext uri='{96DAC541-7B7A-43D3-8B79-37D633B846F1}'>" +
                "<asvg:svgBlip xmlns:asvg='http://schemas.microsoft.com/office/drawing/2016/SVG/main' r:embed='rId2'/>" +
                "</a:ext></a:extLst></a:blip>");
            check(WordPngSourceReader.Read(svgPicture) == null, "SVG fallback is not the original PNG carrier");
            string completeSvgPicture = svgPicture.Replace("</Relationships>",
                "<Relationship Id='rId2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' Target='media/image2.svg'/></Relationships>")
                .Replace("</pkg:package>", "<pkg:part pkg:name='/word/media/image2.svg' pkg:contentType='image/svg+xml'><pkg:xmlData>" +
                    "<svg xmlns='http://www.w3.org/2000/svg'><metadata/></svg></pkg:xmlData></pkg:part></pkg:package>");
            check(WordPngSourceReader.Read(completeSvgPicture) == null, "associated SVG XML part does not enable PNG fallback reading");
            check(WordPngSourceReader.Read(svgPicture.Replace("r:embed='rId2'", "r:link='rId2'")) == null, "linked SVG fallback denied");
            check(WordPngSourceReader.Read(svgPicture.Replace("/2016/SVG/main", "/future/SVG/main")) == null, "unknown SVG extension denied");
            foreach (string xml in new[] {
                Package(target: "../media/image1.png"), Package(target: "https://example.invalid/image.png"),
                Package(mode: "TargetMode='External'"), Package(extra: "<a:blip r:embed='rId1'/>"),
                Package().Replace("r:embed='rId1'", "r:link='rId1'"),
                Package().Replace("/relationships/image'", "/relationships/oleObject'"),
                Package().Replace("pkg:contentType='image/png'", "pkg:contentType='image/jpeg'"),
                Package(binary: "invalid"), Package(binary: "AAAAAAAAAAA="),
                Package().Replace("<pkg:binaryData>", "<pkg:binaryData><x/>"),
                Package().Replace("</Relationships>", "<Relationship Id='rId1'/></Relationships>"),
                Package(extra: "<o:OLEObject xmlns:o='urn:schemas-microsoft-com:office:office'/>"),
                "<!DOCTYPE pkg [<!ENTITY x SYSTEM 'file:///private'>]>" + Package(),
                Package().Replace("</pkg:package>", "<pkg:part pkg:name='/word/document.xml'/></pkg:package>"),
                new string('x', WordPngSourceReader.MaxXmlChars + 1),
            }) check(WordPngSourceReader.Read(xml) == null, "reject unassociated, linked, malformed or oversized image");
            var over = new byte[WordPngSourceReader.MaxPngBytes + 1];
            check(WordPngSourceReader.Read(Package(Convert.ToBase64String(over))) == null, "PNG byte budget");

            var request = new VstoReadPngSource { RequestId = "read-1", SessionId = "word-1", DocumentContextId = "doc-1", CarrierSha256 = new string('a', 64), PngBase64 = Signature };
            VstoMessage decoded = JsonSerializer.Deserialize<VstoMessage>(JsonSerializer.Serialize<VstoMessage>(request));
            check(decoded is VstoReadPngSource png && png.DocumentContextId == "doc-1" && png.PngBase64 == Signature, "request wire roundtrip");
            var response = new DesktopPngSourceResult { RequestId = request.RequestId, SessionId = request.SessionId, DocumentContextId = "doc-1", CarrierSha256 = request.CarrierSha256, Success = true,
                Candidates = new List<FormulaSourceCandidate> { new FormulaSourceCandidate { Format = "latex", Source = "x^2", Provenance = "tEXt / latex" } } };
            DesktopMessage result = JsonSerializer.Deserialize<DesktopMessage>(JsonSerializer.Serialize<DesktopMessage>(response));
            check(result is DesktopPngSourceResult source && source.Candidates.Count == 1 && source.Candidates[0].Source == "x^2", "result wire roundtrip");
            return failures;
        }
    }
}
