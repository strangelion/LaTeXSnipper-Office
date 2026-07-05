using System;
using System.Collections.Generic;
using Microsoft.Office.Interop.Word;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Word;

/// <summary>
/// Core Word operations for formula insert/read/replace/delete.
/// All COM Interop calls MUST execute on the Office UI thread (STA).
/// </summary>
public class WordAdapter
{
    private readonly Application _app;

    public WordAdapter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Insert Formula
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a formula into the current selection.
    /// </summary>
    public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
    {
        var doc = _app.ActiveDocument;
        if (doc == null)
            return new InsertResult { Success = false, Error = "No active document" };

        var range = _app.Selection.Range;

        try
        {
            string ommlXml;
            switch (mode)
            {
                case InsertMode.Inline:
                    ommlXml = BuildInlineOmml(payload.Omml, payload.FormulaId);
                    break;
                case InsertMode.Display:
                    ommlXml = BuildDisplayOmml(payload.Omml, payload.FormulaId);
                    break;
                case InsertMode.DisplayNumbered:
                    ommlXml = BuildNumberedEquation(payload);
                    break;
                default:
                    ommlXml = BuildInlineOmml(payload.Omml, payload.FormulaId);
                    break;
            }

            // Insert via Range.InsertXML
            range.InsertXML(ommlXml);

            // Build up the math content
            try
            {
                if (_app.Selection.OMaths.Count > 0)
                {
                    _app.Selection.OMaths.BuildUp();
                }
            }
            catch { /* BuildUp may fail on some formulas */ }

            // Write metadata to CustomXMLParts
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

    // ---------------------------------------------------------------------------
    // Read Selection
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read formula from current selection.
    /// Order: 1) Check LSNO metadata 2) Check OMath 3) Return null
    /// </summary>
    public FormulaPayload? ReadSelection()
    {
        var range = _app.Selection.Range;
        if (range == null) return null;

        // Step 1: Check for managed formula metadata
        var metadata = FormulaMetadata.Read(range);
        if (metadata != null)
        {
            return metadata;
        }

        // Step 2: Check for OMath in selection
        var omml = ExtractOmmlFromRange(range);
        if (!string.IsNullOrEmpty(omml))
        {
            return new FormulaPayload
            {
                FormulaId = Guid.NewGuid().ToString("N"),
                Omml = omml,
                Latex = "", // Desktop will convert OMML -> LaTeX via Core
                Display = "block"
            };
        }

        return null;
    }

    // ---------------------------------------------------------------------------
    // Replace Formula
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Replace an existing formula by ID.
    /// </summary>
    public bool ReplaceFormula(string formulaId, FormulaPayload newPayload)
    {
        var range = FindFormulaById(formulaId);
        if (range == null) return false;

        try
        {
            // Delete old content and insert new
            range.Delete();
            range.InsertXML(BuildInlineOmml(newPayload.Omml));

            // Update metadata
            var doc = _app.ActiveDocument;
            FormulaMetadata.Update(doc, formulaId, newPayload);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WordAdapter] Replace failed: {ex.Message}");
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Delete Current
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Delete the formula at current selection.
    /// </summary>
    public bool DeleteCurrent()
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            // Try to find parent content control
            if (range.ContentControls.Count > 0)
            {
                range.ContentControls[1].Delete();
                return true;
            }

            // Try to find LSNO bookmark
            foreach (Bookmark bookmark in _app.ActiveDocument.Bookmarks)
            {
                if (bookmark.Name.StartsWith("LSNO:formula:"))
                {
                    bookmark.Range.Delete();
                    return true;
                }
            }

            // Fallback: delete current selection
            range.Delete();
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WordAdapter] Delete failed: {ex.Message}");
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Format Selection / Format All
    // ---------------------------------------------------------------------------

    public void FormatSelection(FormatOptions options)
    {
        var range = _app.Selection.Range;
        ApplyFormatting(range, options);
    }

    public void FormatAll(FormatOptions options)
    {
        var doc = _app.ActiveDocument;
        foreach (Range range in doc.StoryRanges)
        {
            ApplyFormatting(range, options);
        }
    }

    private void ApplyFormatting(Range range, FormatOptions options)
    {
        if (options.FontFamily != null)
            range.Font.Name = options.FontFamily;
        if (options.FontSize.HasValue)
            range.Font.Size = options.FontSize.Value;
        if (options.FontColor != null)
            range.Font.Color = ConvertColor(options.FontColor);
    }

    private static Microsoft.Office.Interop.Word.WdColor ConvertColor(string hex)
    {
        if (hex.StartsWith("#") && hex.Length == 7)
        {
            int r = Convert.ToInt32(hex.Substring(1, 2), 16);
            int g = Convert.ToInt32(hex.Substring(3, 2), 16);
            int b = Convert.ToInt32(hex.Substring(5, 2), 16);
            return (Microsoft.Office.Interop.Word.WdColor)(r + (g << 8) + (b << 16));
        }
        return Microsoft.Office.Interop.Word.WdColor.wdColorAutomatic;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

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
        <w:bookmarkStart w:name=""LSNO:formula:{id}"" w:id=""1""/>
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

    private static string ExtractOmmlFromRange(Range range)
    {
        try
        {
            var xml = range.get_XML();
            if (xml == null) return "";

            // Check for OMath
            if (xml.Contains("<m:oMath") || xml.Contains("<m:oMathPara"))
            {
                // Extract the oMath element
                int start = xml.IndexOf("<m:oMath");
                int end = xml.IndexOf("</m:oMath>") + "</m:oMath>".Length;
                if (start >= 0 && end > start)
                    return xml[start..end];
            }
        }
        catch { }
        return "";
    }

    private Range? FindFormulaById(string formulaId)
    {
        var doc = _app.ActiveDocument;
        foreach (Bookmark bookmark in doc.Bookmarks)
        {
            if (bookmark.Name == $"LSNO:formula:{formulaId}")
            {
                return bookmark.Range;
            }
        }
        return null;
    }
}

public class InsertResult
{
    public bool Success { get; set; }
    public string? FormulaId { get; set; }
    public uint? RangeStart { get; set; }
    public uint? RangeEnd { get; set; }
    public string? Error { get; set; }
}
