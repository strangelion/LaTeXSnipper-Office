// ExcelBatchLatexScanner.cs — Batch LaTeX detection for Excel workbooks.
//
// Scans: Selected Range, Current Worksheet, Entire Workbook
// Detects LaTeX math in: Cell Values, Text Boxes, Shapes with Text
//
// Example: cell A1 contains "$x^2$" → detected as LaTeX candidate.

#nullable enable
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using Excel = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

/// <summary>
/// Scans Excel workbooks for LaTeX math expressions.
/// </summary>
internal sealed class ExcelBatchLatexScanner
{
    private readonly Excel.Application _application;

    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

    public ExcelBatchLatexScanner(Excel.Application application)
    {
        _application = application;
    }

    /// <summary>
    /// Scan for LaTeX candidates in the given scope.
    /// </summary>
    /// <param name="scope">
    /// "selection" — currently selected range,
    /// "currentWorksheet" — active sheet,
    /// "entireWorkbook" — all sheets.
    /// </param>
    public List<LatexCandidateDto> Scan(string scope = "entireWorkbook")
    {
        var candidates = new List<LatexCandidateDto>();

        try
        {
            var wb = _application.ActiveWorkbook;
            if (wb == null) return candidates;

            if (scope.Equals("selection", StringComparison.OrdinalIgnoreCase))
            {
                var range = _application.Selection as Excel.Range;
                if (range != null)
                    ScanRange(range, "Selection", candidates);
            }
            else if (scope.Equals("currentWorksheet", StringComparison.OrdinalIgnoreCase))
            {
                var sheet = _application.ActiveSheet as Excel.Worksheet;
                if (sheet != null)
                    ScanWorksheet(sheet, candidates);
            }
            else
            {
                // Entire workbook
                foreach (Excel.Worksheet sheet in wb.Worksheets)
                {
                    ScanWorksheet(sheet, candidates);
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelBatchLatexScanner] Scan error: {ex.Message}");
        }

        return candidates;
    }

    private void ScanWorksheet(Excel.Worksheet sheet, List<LatexCandidateDto> candidates)
    {
        string sheetName;
        try { sheetName = sheet.Name; } catch { sheetName = "Unknown"; }

        // Scan cell values in the used range
        try
        {
            var usedRange = sheet.UsedRange;
            if (usedRange != null)
                ScanRange(usedRange, sheetName, candidates);
        }
        catch { /* empty sheet */ }

        // Scan text boxes and shapes with text
        try
        {
            foreach (Excel.Shape shape in sheet.Shapes)
            {
                try
                {
                    if (shape.TextFrame2?.HasText != 0) continue;
                    var text = shape.TextFrame2?.TextRange?.Text;
                    if (!string.IsNullOrEmpty(text))
                        ScanText(text, $"{sheetName}/TextBox '{shape.Name}'", candidates);
                }
                catch { /* skip inaccessible shapes */ }
            }
        }
        catch { /* no shapes */ }
    }

    private void ScanRange(Excel.Range range, string location, List<LatexCandidateDto> candidates)
    {
        try
        {
            var value = range.Value;
            if (value == null) return;

            // Handle multi-cell ranges
            if (value is object[,] matrix)
            {
                int rows = matrix.GetLength(0);
                int cols = matrix.GetLength(1);
                for (int r = 1; r <= rows; r++)
                {
                    for (int c = 1; c <= cols; c++)
                    {
                        var cellValue = matrix[r, c]?.ToString();
                        if (!string.IsNullOrEmpty(cellValue))
                        {
                            string cellAddr = $"{(char)('A' + c - 1)}{range.Row + r - 1}";
                            ScanText(cellValue, $"{location}/{cellAddr}", candidates);
                        }
                    }
                }
            }
            else
            {
                string text = value.ToString() ?? "";
                if (!string.IsNullOrEmpty(text))
                    ScanText(text, location, candidates);
            }
        }
        catch { /* skip unreadable ranges */ }
    }

    private void ScanText(string text, string location, List<LatexCandidateDto> candidates)
    {
        var matches = LatexMathPattern.Matches(text);
        int matchIndex = 0;

        foreach (Match match in matches)
        {
            matchIndex++;
            string? latex = match.Groups[1].Success ? match.Groups[1].Value
                : match.Groups[2].Success ? match.Groups[2].Value
                : match.Groups[3].Success ? match.Groups[3].Value
                : match.Groups[4].Success ? match.Groups[4].Value
                : null;

            if (string.IsNullOrWhiteSpace(latex)) continue;

            candidates.Add(new LatexCandidateDto
            {
                Id = $"latex-{location.GetHashCode():x8}-{matchIndex:x4}",
                Source = match.Value.Trim(),
                NormalizedLatex = latex.Trim(),
                Location = $"{location}/{matchIndex}",
                Confidence = 0.95,
            });
        }
    }
}
