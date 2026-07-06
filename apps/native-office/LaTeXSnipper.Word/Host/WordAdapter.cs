using System;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Metadata;

namespace LaTeXSnipper.Word.Host
{
    internal sealed class WordAdapter
    {
        private readonly Microsoft.Office.Interop.Word.Application _application;

        public WordAdapter(Microsoft.Office.Interop.Word.Application application)
        {
            _application = application;
        }

        public string HostType => "word";

        public string GetCurrentDocumentContextId()
        {
            return GetCurrentContextId();
        }

        public FormulaPayload? ReadSelection()
        {
            try
            {
                var range = _application.Selection.Range;
                if (range == null) return null;

                // Layer 1: OMath collection (cursor inside math zone)
                if (range.OMaths.Count > 0)
                {
                    try
                    {
                        var oMath = range.OMaths[1];
                        var formulaId = Guid.NewGuid().ToString("N").Substring(0, 12);

                        // Get OMML from WordOpenXML
                        var oMathXml = oMath.Range.WordOpenXML;
                        if (!string.IsNullOrEmpty(oMathXml))
                        {
                            var omml = ExtractOmmlFromXml(oMathXml);
                            if (!string.IsNullOrEmpty(omml))
                            {
                                // Return OMML only; Rust Core will convert to LaTeX
                                return new FormulaPayload
                                {
                                    FormulaId = formulaId,
                                    Omml = omml,
                                    Latex = "",
                                    Display = "block"
                                };
                            }
                        }
                    }
                    catch { }
                }

                // Layer 2: Range.WordOpenXML → find nearest <m:oMath>
                try
                {
                    var xml = range.WordOpenXML;
                    if (!string.IsNullOrEmpty(xml))
                    {
                        var omml = ExtractOmmlFromXml(xml);
                        if (!string.IsNullOrEmpty(omml))
                        {
                            return new FormulaPayload
                            {
                                FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
                                Omml = omml,
                                Latex = "",
                                Display = "block"
                            };
                        }
                    }
                }
                catch { }

                // Layer 3: Clipboard fallback
                if (_application.Selection.OMaths.Count > 0)
                {
                    try
                    {
                        var oMath = _application.Selection.OMaths[1];
                        oMath.Range.Copy();
                        var clipXml = System.Windows.Forms.Clipboard.GetData("XML") as string;
                        if (!string.IsNullOrEmpty(clipXml))
                        {
                            var omml = ExtractOmmlFromXml(clipXml);
                            if (!string.IsNullOrEmpty(omml))
                            {
                                return new FormulaPayload
                                {
                                    FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
                                    Omml = omml,
                                    Latex = "",
                                    Display = "block"
                                };
                            }
                        }
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] ReadSelection error: {ex.Message}");
            }

            return null;
        }

        private static string ExtractOmmlFromXml(string xml)
        {
            if (string.IsNullOrEmpty(xml)) return null;

            int oMathStart = -1;
            string closeTag = "";

            var paraStart = xml.IndexOf("<m:oMathPara");
            if (paraStart >= 0)
            {
                oMathStart = paraStart;
                closeTag = "</m:oMathPara>";
            }
            else
            {
                var mathStart = xml.IndexOf("<m:oMath");
                if (mathStart >= 0)
                {
                    var afterTag = xml.Substring(mathStart + 8, 1);
                    if (afterTag != "P" && afterTag != ">")
                    {
                        oMathStart = mathStart;
                        closeTag = "</m:oMath>";
                    }
                }
            }

            if (oMathStart < 0) return null;

            var endTag = xml.IndexOf(closeTag, oMathStart);
            if (endTag < 0) return null;

            return xml.Substring(oMathStart, endTag + closeTag.Length - oMathStart);
        }

        public InsertResult DeleteCurrent()
        {
            try
            {
                var range = _application.Selection.Range;
                if (_application.Selection.OMaths.Count > 0)
                {
                    _application.Selection.OMaths[1].Range.Delete();
                    return new InsertResult { Success = true };
                }
                range.Delete();
                return new InsertResult { Success = true };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        public InsertResult ReplaceFormula(string formulaId, FormulaPayload newPayload)
        {
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null) return new InsertResult { Success = false, Error = "No document" };

                // Find formula by bookmark
                foreach (Microsoft.Office.Interop.Word.Bookmark bm in doc.Bookmarks)
                {
                    if (bm.Name == $"LSNO:formula:{formulaId}")
                    {
                        var range = bm.Range;
                        range.Delete();
                        // Insert new formula text
                        _application.Selection.SetRange(range.Start, range.Start);
                        _application.Selection.TypeText(newPayload.Latex);
                        return new InsertResult { Success = true, FormulaId = formulaId };
                    }
                }
                return new InsertResult { Success = false, Error = "Formula not found" };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        public void InsertText(string value)
        {
            System.Diagnostics.Debug.WriteLine(
                "[WordAdapter] InsertText called.");
            _application.Selection.TypeText(value);
        }

        public string GetCurrentContextId()
        {
            var document = _application.ActiveDocument;
            if (document == null)
                return "word:unsaved:none";
            var fullName = document.FullName;
            if (!string.IsNullOrWhiteSpace(fullName))
                return "word:" + fullName;
            return "word:" + document.Name;
        }

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            var doc = _application.ActiveDocument;
            if (doc == null)
                return new InsertResult { Success = false, Error = "No active document" };

            var range = _application.Selection.Range;
            try
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] OMML to insert: [{payload.Omml}]");

                var cleanOmml = NormalizeOmml(payload.Omml, mode);
                if (string.IsNullOrWhiteSpace(cleanOmml))
                    return new InsertResult { Success = false, Error = "OMML conversion returned empty content" };

                var body = mode == InsertMode.DisplayNumbered
                    ? BuildNumberedEquationBody(cleanOmml, payload.FormulaId)
                    : BuildFormulaBody(cleanOmml, payload.FormulaId, mode);
                var flatOpc = BuildFlatOpc(body);

                range.InsertXML(flatOpc);

                FormulaMetadata.Write(doc, payload.FormulaId, payload);

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)range.Start,
                    RangeEnd = (uint)range.End
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] InsertFormula error: {ex.Message}");
                return new InsertResult
                {
                    Success = false,
                    Error = $"Insert failed: {ex.Message}"
                };
            }
        }

        private static string NormalizeOmml(string omml, InsertMode mode)
        {
            if (string.IsNullOrWhiteSpace(omml)) return "";

            var clean = System.Text.RegularExpressions.Regex.Replace(
                omml,
                @"<m:rPr>.*?</m:rPr>",
                "",
                System.Text.RegularExpressions.RegexOptions.Singleline);

            if (clean.Contains("<m:oMathPara>"))
            {
                var start = clean.IndexOf("<m:oMath>");
                var end = clean.LastIndexOf("</m:oMath>");
                if (start >= 0 && end > start)
                    clean = clean.Substring(start, end + "</m:oMath>".Length - start);
            }
            else if (!clean.Contains("<m:oMath"))
            {
                clean = $"<m:oMath>{clean}</m:oMath>";
            }

            if (mode == InsertMode.Inline && clean.Contains("<m:oMathPara>"))
                clean = clean.Replace("<m:oMathPara>", "").Replace("</m:oMathPara>", "");

            return clean;
        }

        private static string BuildFormulaBody(string omml, string formulaId, InsertMode mode)
        {
            var paragraphProperties = mode == InsertMode.Display
                ? "<w:pPr><w:jc w:val=\"center\"/></w:pPr>"
                : "";

            return $@"<w:sdt>
  <w:sdtPr>
    <w:alias w:val=""LaTeXSnipper Formula""/>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      {paragraphProperties}
      {omml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
        }

        private static string BuildNumberedEquationBody(string omml, string formulaId)
        {
            return $@"<w:sdt>
  <w:sdtPr>
    <w:alias w:val=""LaTeXSnipper Numbered Formula""/>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:tbl>
      <w:tr>
        <w:tc><w:p/></w:tc>
        <w:tc><w:p><w:pPr><w:jc w:val=""center""/></w:pPr>{omml}</w:p></w:tc>
        <w:tc><w:p><w:pPr><w:jc w:val=""right""/></w:pPr><w:r><w:t>(</w:t></w:r><w:r><w:fldChar w:fldCharType=""begin""/></w:r><w:r><w:instrText xml:space=""preserve""> SEQ LaTeXSnipperEquation \* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType=""end""/></w:r><w:r><w:t>)</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:sdtContent>
</w:sdt>";
        }

        private static string BuildFlatOpc(string body)
        {
            return $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage"">
  <pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml"">
    <pkg:xmlData>
      <Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships"">
        <Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/>
      </Relationships>
    </pkg:xmlData>
  </pkg:part>
  <pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"">
    <pkg:xmlData>
      <w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main"" xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
        <w:body>{body}</w:body>
      </w:document>
    </pkg:xmlData>
  </pkg:part>
</pkg:package>";
        }

        private static string BuildInlineOmml(string omml, string formulaId)
        {
            return $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      <w:pPr><w:jc w:val=""center""/></w:pPr>
      {omml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
        }

        private static string BuildDisplayOmml(string omml, string formulaId)
        {
            return $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      {omml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
        }
    }

    internal sealed class InsertResult
    {
        public bool Success { get; set; }
        public string FormulaId { get; set; } = "";
        public uint? RangeStart { get; set; }
        public uint? RangeEnd { get; set; }
        public string Error { get; set; } = "";
    }
}
