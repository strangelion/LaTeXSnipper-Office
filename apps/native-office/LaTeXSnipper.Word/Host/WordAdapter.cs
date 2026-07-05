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

                // Strip <m:rPr> (may contain invalid <w:rPr> from converter)
                var cleanOmml = System.Text.RegularExpressions.Regex.Replace(
                    payload.Omml,
                    @"<m:rPr>.*?</m:rPr>",
                    "",
                    System.Text.RegularExpressions.RegexOptions.Singleline);

                // Wrap <m:r> in <m:oMath> if missing inside <m:oMathPara>
                if (cleanOmml.Contains("<m:oMathPara>") && !cleanOmml.Contains("<m:oMath>"))
                {
                    cleanOmml = cleanOmml.Replace("<m:oMathPara>", "<m:oMathPara><m:oMath>");
                    cleanOmml = cleanOmml.Replace("</m:oMathPara>", "</m:oMath></m:oMathPara>");
                }

                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] Cleaned OMML: [{cleanOmml}]");

                // Build XML with <w:sdt> content control
                // <m:oMath> (inline) goes inside <w:p>; <m:oMathPara> (display) replaces <w:p>
                string ommlXml;
                if (cleanOmml.Contains("<m:oMathPara>"))
                {
                    // Display math: <m:oMathPara> is paragraph-level, goes directly in <w:sdtContent>
                    ommlXml = $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{payload.FormulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    {cleanOmml}
  </w:sdtContent>
</w:sdt>";
                }
                else
                {
                    // Inline math: <m:oMath> goes inside <w:p>
                    ommlXml = $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{payload.FormulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      {cleanOmml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
                }

                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] InsertXML ({ommlXml.Length} chars)");
                range.InsertXML(ommlXml);
                System.Diagnostics.Debug.WriteLine("[WordAdapter] InsertXML succeeded");

                try
                {
                    if (_application.Selection.OMaths.Count > 0)
                        _application.Selection.OMaths.BuildUp();
                }
                catch (Exception buildEx)
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"[WordAdapter] BuildUp error (non-fatal): {buildEx.Message}");
                }

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
