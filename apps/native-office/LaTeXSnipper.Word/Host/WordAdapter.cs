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
            var range = _application.Selection.Range;
            if (range == null) return null;

            // Step 1: Check for managed formula metadata (CustomXMLParts)
            var metadata = FormulaMetadata.Read(range);
            if (metadata != null)
                return metadata;

            // Step 2: Try to extract OMML from OMath at selection
            if (_application.Selection.OMaths.Count > 0)
            {
                try
                {
                    var omml = _application.Selection.OMaths[1].Range.get_XML(false);
                    if (!string.IsNullOrEmpty(omml))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = Guid.NewGuid().ToString("N"),
                            Omml = omml,
                            Latex = "",
                            Display = "block"
                        };
                    }
                }
                catch { }
            }

            return null;
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

                // Extract <m:oMath> from <m:oMathPara> - InsertXML works with <m:oMath> inside <w:p>
                var mathContent = cleanOmml;
                if (mathContent.Contains("<m:oMathPara>"))
                {
                    var start = mathContent.IndexOf("<m:oMath>");
                    var end = mathContent.LastIndexOf("</m:oMath>") + "</m:oMath>".Length;
                    if (start >= 0 && end > start)
                        mathContent = mathContent.Substring(start, end - start);
                }

                // Use Word's OMath object model instead of InsertXML
                // OMaths.Add creates a math zone at the selection
                System.Diagnostics.Debug.WriteLine("[WordAdapter] Creating OMath...");
                var oMath = _application.Selection.OMaths.Add(range);
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] OMath created, OMaths count: {_application.Selection.OMaths.Count}");

                // Type the LaTeX source into the math zone
                var latex = payload.Latex;
                if (!string.IsNullOrEmpty(latex))
                {
                    _application.Selection.TypeText(latex);
                    System.Diagnostics.Debug.WriteLine(
                        $"[WordAdapter] Typed LaTeX: {latex}");

                    // Build up the equation (convert linear to professional)
                    try
                    {
                        _application.Selection.OMaths.BuildUp();
                        System.Diagnostics.Debug.WriteLine("[WordAdapter] BuildUp succeeded");
                    }
                    catch (Exception buildEx)
                    {
                        System.Diagnostics.Debug.WriteLine(
                            $"[WordAdapter] BuildUp error (non-fatal): {buildEx.Message}");
                    }
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
