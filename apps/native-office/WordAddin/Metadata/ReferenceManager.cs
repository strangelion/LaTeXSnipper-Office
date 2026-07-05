using System;
using System.Collections.Generic;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.NativeOffice.Word.Metadata;

/// <summary>
/// Manages cross-references to numbered formulas in Word documents.
/// 
/// Cross-references use Word's built-in REF field:
///   { REF LSNO:ref:<refId> \h }
/// 
/// Reference metadata is stored in CustomXMLParts under:
///   LSNO:ref:<refId> → formulaId + label + number
/// </summary>
public class ReferenceManager
{
    private readonly Application _app;
    private readonly NumberingManager _numbering;

    public ReferenceManager(Application app, NumberingManager numbering)
    {
        _app = app;
        _numbering = numbering;
    }

    // ---------------------------------------------------------------------------
    // Insert cross-reference
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a cross-reference to a managed formula.
    /// </summary>
    public bool InsertReference(string formulaId, string referenceType = "ref")
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            // Find the formula's numbering bookmark
            var numBookmark = FindNumberBookmark(formulaId);
            if (numBookmark == null)
            {
                System.Diagnostics.Debug.WriteLine($"[ReferenceManager] No numbering found for formula {formulaId}");
                return false;
            }

            // Generate a unique reference ID
            var refId = Guid.NewGuid().ToString("N")[..8];

            // Add reference bookmark
            _app.ActiveDocument.Bookmarks.Add(
                $"LSNO:ref:{refId}",
                range
            );

            // Insert REF field
            var fieldCode = $" REF LSNO:num:{formulaId} \\h ";
            range.Fields.Add(range, WdFieldType.wdFieldEmpty, fieldCode);

            // Store reference metadata in CustomXML
            WriteReferenceMetadata(refId, formulaId, referenceType);

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ReferenceManager] InsertReference failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Insert a page reference to a formula.
    /// </summary>
    public bool InsertPageReference(string formulaId)
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            var fieldCode = $" REF LSNO:num:{formulaId} \\p ";
            range.Fields.Add(range, WdFieldType.wdFieldEmpty, fieldCode);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ReferenceManager] InsertPageReference failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Insert a number-only reference (just the equation number).
    /// </summary>
    public bool InsertNumberReference(string formulaId)
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            var fieldCode = $" REF LSNO:num:{formulaId} \\n ";
            range.Fields.Add(range, WdFieldType.wdFieldEmpty, fieldCode);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ReferenceManager] InsertNumberReference failed: {ex.Message}");
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Get available formulas for reference
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Get a list of all numbered formulas that can be referenced.
    /// </summary>
    public List<ReferenceableFormula> GetReferenceableFormulas(Document? doc = null)
    {
        doc ??= _app.ActiveDocument;
        var result = new List<ReferenceableFormula>();

        foreach (Bookmark bookmark in doc.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:formula:"))
            {
                var formulaId = bookmark.Name.Replace("LSNO:formula:", "");
                var hasNumber = doc.Bookmarks.Exists($"LSNO:num:{formulaId}");

                if (hasNumber)
                {
                    // Try to get the equation number
                    var number = GetFormulaNumber(formulaId, doc);
                    result.Add(new ReferenceableFormula
                    {
                        FormulaId = formulaId,
                        Number = number,
                        Range = bookmark.Range
                    });
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Get the current number of a formula by scanning SEQ fields.
    /// </summary>
    public string GetFormulaNumber(string formulaId, Document? doc = null)
    {
        doc ??= _app.ActiveDocument;

        // Find the bookmark for this formula's number
        var bookmarkName = $"LSNO:num:{formulaId}";
        if (!doc.Bookmarks.Exists(bookmarkName))
            return "?";

        var bookmark = doc.Bookmarks[bookmarkName];

        // Find the SEQ field near this bookmark
        foreach (Field field in doc.Fields)
        {
            if (field.Code.Text.Contains("SEQ LSNO"))
            {
                var fieldRange = field.Code;
                if (Math.Abs(fieldRange.Start - bookmark.Range.Start) < 200)
                {
                    // Update and get the field result
                    field.Update();
                    return field.Result.Text.Trim();
                }
            }
        }

        return "?";
    }

    // ---------------------------------------------------------------------------
    // Update all references
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Update all cross-reference fields in the document.
    /// Call this after renumbering.
    /// </summary>
    public void UpdateAllReferences(Document? doc = null)
    {
        doc ??= _app.ActiveDocument;
        doc.Fields.Update();
    }

    // ---------------------------------------------------------------------------
    // Delete reference
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Delete a reference bookmark.
    /// </summary>
    public bool DeleteReference(string refId)
    {
        var bookmarkName = $"LSNO:ref:{refId}";
        if (_app.ActiveDocument.Bookmarks.Exists(bookmarkName))
        {
            _app.ActiveDocument.Bookmarks[bookmarkName].Range.Delete();
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private Bookmark? FindNumberBookmark(string formulaId)
    {
        var bookmarkName = $"LSNO:num:{formulaId}";
        if (_app.ActiveDocument.Bookmarks.Exists(bookmarkName))
        {
            return _app.ActiveDocument.Bookmarks[bookmarkName];
        }
        return null;
    }

    private void WriteReferenceMetadata(string refId, string formulaId, string referenceType)
    {
        try
        {
            var doc = _app.ActiveDocument;
            var xml = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<lsno:noffice xmlns:lsno=""urn:latexsnipper:native-office:v2"">
  <lsno:ref id=""{refId}"" formulaId=""{formulaId}"" type=""{referenceType}"" />
</lsno:noffice>";

            doc.CustomXMLParts.Add(xml);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ReferenceManager] WriteReferenceMetadata failed: {ex.Message}");
        }
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

public class ReferenceableFormula
{
    public string FormulaId { get; set; } = "";
    public string Number { get; set; } = "";
    public Range? Range { get; set; }
}
