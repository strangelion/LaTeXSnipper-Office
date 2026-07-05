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
            {
                return "word:unsaved:none";
            }

            var fullName = document.FullName;
            if (!string.IsNullOrWhiteSpace(fullName))
            {
                return "word:" + fullName;
            }

            return "word:" + document.Name;
        }

        // -----------------------------------------------------------------------
        // OMML Insertion
        // -----------------------------------------------------------------------

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

                System.Diagnostics.Debug.WriteLine(
                    "[WordAdapter] Inserting formula via InsertXML...");

                // Strip <m:rPr> entirely (contains invalid <w:rPr> from converter)
                var cleanOmml = System.Text.RegularExpressions.Regex.Replace(
                    payload.Omml,
                    @"<m:rPr>.*?</m:rPr>",
                    "",
                    System.Text.RegularExpressions.RegexOptions.Singleline);

                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] Cleaned OMML: [{cleanOmml}]");

                var ommlXml = $@"<w:p xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  {cleanOmml}
</w:p>";
                range.InsertXML(ommlXml);

                System.Diagnostics.Debug.WriteLine(
                    "[WordAdapter] InsertXML succeeded");

                try
                {
                    if (_application.Selection.OMaths.Count > 0)
                    {
                        _application.Selection.OMaths.BuildUp();
                    }
                }
                catch { }

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
                return new InsertResult
                {
                    Success = false,
                    Error = $"Insert failed: {ex.Message}"
                };
            }
        }

        private static string BuildInlineOmml(string omml, string formulaId)
        {
            return $@"<w:p xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
      {omml}
</w:p>";
        }

        private static string BuildDisplayOmml(string omml, string formulaId)
        {
            return $@"<w:p xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
      {omml}
</w:p>";
        }

        private static string BuildNumberedEquation(FormulaPayload payload)
        {
            return $@"<w:tbl xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:tblPr>
    <w:tblW w:w=""5000"" w:type=""pct""/>
    <w:jc w:val=""center""/>
  </w:tblPr>
  <w:tr>
    <w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
    <w:tc>
      <w:p>
        <w:pPr><w:jc w:val=""center""/></w:pPr>
        <w:bookmarkStart w:name=""LSNO:formula:{payload.FormulaId}"" w:id=""1""/>
        {payload.Omml}
        <w:bookmarkEnd w:id=""1""/>
      </w:p>
    </w:tc>
    <w:tc>
      <w:p>
        <w:pPr><w:jc w:val=""right""/></w:pPr>
        <w:r>
          <w:fldChar w:fldCharType=""begin""/>
        </w:r>
        <w:r>
          <w:instrText xml:space=""preserve""> SEQ LSNO \* ARABIC </w:instrText>
        </w:r>
        <w:r>
          <w:fldChar w:fldCharType=""separate""/>
        </w:r>
        <w:r>
          <w:t>(1)</w:t>
        </w:r>
        <w:r>
          <w:fldChar w:fldCharType=""end""/>
        </w:r>
      </w:p>
    </w:tc>
  </w:tr>
</w:tbl>";
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
