using System;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class WordSvgBindingTests
    {
        internal static string Package(string svg = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='24'/></svg>") =>
            "<pkg:package xmlns:pkg='http://schemas.microsoft.com/office/2006/xmlPackage'>" +
            "<pkg:part pkg:name='/word/document.xml'><pkg:xmlData><w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:a='http://schemas.openxmlformats.org/drawingml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><w:body><a:blip r:embed='png'><a:extLst><a:ext uri='{96DAC541-7B7A-43D3-8B79-37D633B846F1}'><asvg:svgBlip xmlns:asvg='http://schemas.microsoft.com/office/drawing/2016/SVG/main' r:embed='svg'/></a:ext></a:extLst></a:blip></w:body></w:document></pkg:xmlData></pkg:part>" +
            "<pkg:part pkg:name='/word/_rels/document.xml.rels'><pkg:xmlData><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='svg' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' Target='media/image2.svg'/></Relationships></pkg:xmlData></pkg:part>" +
            "<pkg:part pkg:name='/word/media/image2.svg' pkg:contentType='image/svg+xml'><pkg:xmlData>" + svg + "</pkg:xmlData></pkg:part></pkg:package>";

        internal static int Run()
        {
            int failures = 0;
            Action<bool, string> check = (ok, message) => { if (!ok) { Console.Error.WriteLine("FAIL " + message); failures++; } };
            string xml = Package();
            var payload = new FormulaPayload { FormulaId = "test-svg", Latex = "x^2", StorageMode = "image",
                Render = new RenderData { Svg = "<svg xmlns='http://www.w3.org/2000/svg'><metadata>x^2</metadata></svg>" },
                EditorState = JsonSerializer.Deserialize<JsonElement>("{ \"kind\" : \"drawing\", \"source\" : \"x^2\" }") };
            payload.Source = new SourceInfo { WordSvgBinding = WordSvgSourceBinding.Create(payload, xml) };
            check(payload.Source.WordSvgBinding != null && WordSvgSourceBinding.Matches(payload, xml), "source is bound to actual Word SVG");
            var restored = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload));
            check(WordSvgSourceBinding.Matches(restored, xml), "binding and editor state survive payload wire serialization");
            check(!WordSvgSourceBinding.Matches(restored, Package("<svg xmlns='http://www.w3.org/2000/svg'><rect width='25'/></svg>")), "replaced image denied");
            restored.Latex = "y^2";
            check(!WordSvgSourceBinding.Matches(restored, xml), "changed LaTeX denied");
            restored = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload));
            restored.Render.Svg += " ";
            check(!WordSvgSourceBinding.Matches(restored, xml), "changed original SVG denied");
            restored = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload));
            restored.EditorState = JsonSerializer.Deserialize<JsonElement>("{\"kind\":\"drawing\",\"source\":\"y^2\"}");
            check(!WordSvgSourceBinding.Matches(restored, xml), "changed editor source denied");
            foreach (string invalid in new[] {
                xml.Replace("r:embed='svg'", "r:link='svg'"), xml.Replace("media/image2.svg", "../image2.svg"),
                xml.Replace("Target='media/image2.svg'", "Target='media/image2.svg' TargetMode='External'"),
                xml.Replace("image/svg+xml", "image/png"), xml.Replace("/2016/SVG/main", "/future/SVG/main"),
                xml.Replace("</Relationships>", "<Relationship Id='svg'/></Relationships>"),
                xml.Replace("</pkg:package>", "<pkg:part pkg:name='/word/media/image2.svg'/></pkg:package>"),
                Package("<svg xmlns='http://www.w3.org/2000/svg'/><svg xmlns='http://www.w3.org/2000/svg'/>"),
                "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///private'>]>" + xml,
                new string('x', WordPngSourceReader.MaxXmlChars + 1),
            }) check(WordSvgSourceBinding.CarrierHash(invalid) == null, "invalid association/framing/budget denied");
            string body = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='24'/></svg>";
            string binary = xml.Replace("<pkg:xmlData>" + body + "</pkg:xmlData>",
                "<pkg:binaryData>" + Convert.ToBase64String(Encoding.UTF8.GetBytes(body)) + "</pkg:binaryData>");
            check(WordSvgSourceBinding.CarrierHash(binary) == WordSvgSourceBinding.CarrierHash(xml), "binary SVG uses same materialized identity");
            restored = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload));
            restored.Source.WordSvgBinding.WordSvgSha256 = null;
            check(!WordSvgSourceBinding.Matches(restored, null), "missing carrier hash cannot match an invalid carrier");
            restored.Source.WordSvgBinding.Version = 2;
            check(!WordSvgSourceBinding.Matches(restored, xml), "unknown binding version denied");
            payload.Render.Svg = new string('x', WordSvgSourceBinding.MaxSvgBytes + 1);
            check(WordSvgSourceBinding.Create(payload, xml) == null, "original asset size budget");
            var legacy = JsonSerializer.Deserialize<SourceInfo>("{\"coreVersion\":\"3.2.1\",\"converterVersion\":\"\",\"ommlSha256\":\"\"}");
            check(legacy.WordSvgBinding == null, "legacy source payload remains unverified");
            return failures;
        }
    }
}
