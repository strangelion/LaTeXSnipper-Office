using System;
using System.Collections.Generic;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.NativeOffice.Word.Metadata;

/// <summary>
/// Manages formula numbering in Word documents.
/// 
/// Numbering uses a 3-column table layout:
/// ┌─────────────┬──────────────────┬─────────────┐
/// │ (空白)       │   公式 (居中)     │ 编号 (右对齐) │
/// │             │   m:oMathPara    │ SEQ \* ARABIC│
/// └─────────────┴──────────────────┴─────────────┘
/// 
/// Bookmark naming convention:
///   LSNO:formula:<id>  - formula column
///   LSNO:eq:<id>       - equation table row
///   LSNO:num:<id>      - numbering field
/// 
/// SEQ Field: \ SEQ LSNO \* ARABIC for auto-numbering
/// </summary>
public class NumberingManager
{
    private readonly Application _app;

    public NumberingManager(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Renumber all managed formulas
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Renumber all LSNO-managed numbered formulas in the document.
    /// Scans all story ranges (main body, footnotes, headers, etc.).
    /// </summary>
    public RenumberResult RenumberAll(Document? doc = null, uint? startFrom = null)
    {
        doc ??= _app.ActiveDocument;
        if (doc == null)
            return new RenumberResult { Success = false, Error = "No active document" };

        int counter = startFrom?.ToString() != null ? (int)startFrom.Value - 1 : 0;
        string currentChapter = "";
        string currentSection = "";
        int totalRenumbered = 0;

        try
        {
            // Scan all story ranges
            foreach (Range storyRange in doc.StoryRanges)
            {
                var range = storyRange;
                while (range != null)
                {
                    // Check for chapter/section separators
                    if (IsChapterSeparator(range))
                    {
                        currentChapter = GetChapterNumber(range);
                        counter = 0;
                    }
                    if (IsSectionSeparator(range))
                    {
                        currentSection = GetSectionNumber(range);
                        counter = 0;
                    }

                    // Find all LSNO numbered bookmarks
                    counter += RenumberInRange(range, currentChapter, currentSection);
                    totalRenumbered = counter;

                    // Get next story range if linked
                    range = range.NextStoryRange;
                }
            }

            // Update all fields in document
            doc.Fields.Update();

            return new RenumberResult
            {
                Success = true,
                Count = totalRenumbered,
                Chapter = currentChapter,
                Section = currentSection
            };
        }
        catch (Exception ex)
        {
            return new RenumberResult
            {
                Success = false,
                Error = $"Renumber failed: {ex.Message}"
            };
        }
    }

    private int RenumberInRange(Range range, string chapter, string section)
    {
        int count = 0;
        var bookmarks = new List<Bookmark>();

        // Collect bookmarks first (can't modify collection while iterating)
        foreach (Bookmark bookmark in range.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:num:"))
            {
                bookmarks.Add(bookmark);
            }
        }

        foreach (var bookmark in bookmarks)
        {
            count++;
            var field = FindFieldByBookmark(bookmark);
            if (field != null)
            {
                // Update the SEQ field code
                field.Code.Text = $" SEQ LSNO \\* ARABIC ";
                field.Update();
            }
        }

        return count;
    }

    // ---------------------------------------------------------------------------
    // Chapter/Section separator detection
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Check if a range contains a chapter separator bookmark.
    /// Chapter separators use: LSNO:chapter:<number>
    /// </summary>
    public bool IsChapterSeparator(Range range)
    {
        foreach (Bookmark bookmark in range.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:chapter:"))
                return true;
        }
        return false;
    }

    /// <summary>
    /// Check if a range contains a section separator bookmark.
    /// Section separators use: LSNO:section:<chapter>.<section>
    /// </summary>
    public bool IsSectionSeparator(Range range)
    {
        foreach (Bookmark bookmark in range.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:section:"))
                return true;
        }
        return false;
    }

    public string GetChapterNumber(Range range)
    {
        foreach (Bookmark bookmark in range.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:chapter:"))
            {
                return bookmark.Name.Replace("LSNO:chapter:", "");
            }
        }
        return "";
    }

    public string GetSectionNumber(Range range)
    {
        foreach (Bookmark bookmark in range.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:section:"))
            {
                return bookmark.Name.Replace("LSNO:section:", "");
            }
        }
        return "";
    }

    // ---------------------------------------------------------------------------
    // Insert chapter/section separators
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a chapter separator at the current selection.
    /// </summary>
    public bool InsertChapterSeparator(string? chapterNumber = null)
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            chapterNumber ??= GetNextChapterNumber();

            // Insert a managed marker paragraph
            var para = range.Paragraphs.Add();
            para.Range.InsertAfter($"Chapter {chapterNumber}");

            // Add chapter bookmark
            _app.ActiveDocument.Bookmarks.Add(
                $"LSNO:chapter:{chapterNumber}",
                para.Range
            );

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[NumberingManager] InsertChapterSeparator failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Insert a section separator at the current selection.
    /// </summary>
    public bool InsertSectionSeparator(string? sectionNumber = null)
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            sectionNumber ??= GetNextSectionNumber();

            // Insert a managed marker paragraph
            var para = range.Paragraphs.Add();
            para.Range.InsertAfter($"Section {sectionNumber}");

            // Add section bookmark
            _app.ActiveDocument.Bookmarks.Add(
                $"LSNO:section:{sectionNumber}",
                para.Range
            );

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[NumberingManager] InsertSectionSeparator failed: {ex.Message}");
            return false;
        }
    }

    private string GetNextChapterNumber()
    {
        int max = 0;
        foreach (Bookmark bookmark in _app.ActiveDocument.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:chapter:"))
            {
                var numStr = bookmark.Name.Replace("LSNO:chapter:", "");
                if (int.TryParse(numStr, out int num) && num > max)
                    max = num;
            }
        }
        return (max + 1).ToString();
    }

    private string GetNextSectionNumber()
    {
        // Get current chapter
        string chapter = "1";
        foreach (Bookmark bookmark in _app.ActiveDocument.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:section:"))
            {
                var parts = bookmark.Name.Replace("LSNO:section:", "").Split('.');
                if (parts.Length == 2 && int.TryParse(parts[1], out _))
                {
                    chapter = parts[0];
                }
            }
        }

        int max = 0;
        foreach (Bookmark bookmark in _app.ActiveDocument.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:section:"))
            {
                var parts = bookmark.Name.Replace("LSNO:section:", "").Split('.');
                if (parts.Length == 2 && parts[0] == chapter && int.TryParse(parts[1], out int num) && num > max)
                    max = num;
            }
        }
        return $"{chapter}.{max + 1}";
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Find the SEQ field associated with a numbering bookmark.
    /// </summary>
    private Field? FindFieldByBookmark(Bookmark bookmark)
    {
        var range = bookmark.Range;
        var doc = range.Document;

        // Look for fields in the same paragraph
        foreach (Field field in doc.Fields)
        {
            if (field.Code.Text.Contains("SEQ LSNO"))
            {
                // Check if field is near the bookmark
                var fieldRange = field.Code;
                if (Math.Abs(fieldRange.Start - range.Start) < 200)
                {
                    return field;
                }
            }
        }
        return null;
    }

    /// <summary>
    /// Get all managed formula bookmarks in the document.
    /// </summary>
    public List<FormulaBookmark> GetAllFormulas(Document? doc = null)
    {
        doc ??= _app.ActiveDocument;
        var result = new List<FormulaBookmark>();

        foreach (Bookmark bookmark in doc.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:formula:"))
            {
                var id = bookmark.Name.Replace("LSNO:formula:", "");
                var hasNumber = doc.Bookmarks.Exists($"LSNO:num:{id}");
                result.Add(new FormulaBookmark
                {
                    Id = id,
                    Range = bookmark.Range,
                    HasNumber = hasNumber
                });
            }
        }

        return result;
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

public class RenumberResult
{
    public bool Success { get; set; }
    public int Count { get; set; }
    public string Chapter { get; set; } = "";
    public string Section { get; set; } = "";
    public string? Error { get; set; }
}

public class FormulaBookmark
{
    public string Id { get; set; } = "";
    public Range? Range { get; set; }
    public bool HasNumber { get; set; }
}
