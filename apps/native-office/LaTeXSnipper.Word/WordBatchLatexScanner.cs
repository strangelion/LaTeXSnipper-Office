// WordBatchLatexScanner.cs — Batch LaTeX detection for Word documents.
//
// Scans: Document Body, Tables, Text Boxes, Headers, Footers
// Detects LaTeX math expressions (e.g., $x^2$, $$...$$, \(...\), \[...\]).
// Returns LatexCandidateDto[] for the Desktop to normalize and convert.

#nullable enable
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host;

/// <summary>
/// Scans a Word document for LaTeX math expressions.
/// </summary>
internal sealed class WordBatchLatexScanner
{
    private readonly Application _application;

    /// <summary>
    /// Regex pattern for LaTeX math delimiters:
    /// $...$, $$...$$, \(...\), \[...\]
    /// </summary>
    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

    public WordBatchLatexScanner(Application application)
    {
        _application = application;
    }

    /// <summary>
    /// Scan the current document for LaTeX candidates.
    /// </summary>
    /// <param name="scope">Selection, EntireDocument</param>
    /// <returns>Detected LaTeX candidates.</returns>
    public List<LatexCandidateDto> Scan(string scope = "entireDocument")
    {
        var candidates = new List<LatexCandidateDto>();

        try
        {
            var doc = _application.ActiveDocument;
            if (doc == null) return candidates;

            if (scope.Equals("selection", StringComparison.OrdinalIgnoreCase))
            {
                ScanRange(_application.Selection.Range, "Selection", candidates);
            }
            else
            {
                // Full document scan
                ScanRange(doc.Content, "Body", candidates);

                // Scan tables
                int tableIndex = 1;
                foreach (Table table in doc.Tables)
                {
                    for (int row = 1; row <= table.Rows.Count; row++)
                    {
                        for (int col = 1; col <= table.Columns.Count; col++)
                        {
                            try
                            {
                                var cell = table.Cell(row, col);
                                ScanRange(cell.Range, $"Table {tableIndex} / Row {row} / Col {col}", candidates);
                            }
                            catch { /* skip inaccessible cells */ }
                        }
                    }
                    tableIndex++;
                }

                // Scan text boxes (shapes)
                foreach (Shape shape in doc.Shapes)
                {
                    try
                    {
                        if (shape.TextFrame.HasText != 0)
                        {
                            ScanRange(shape.TextFrame.TextRange, $"TextBox '{shape.Name}'", candidates);
                        }
                    }
                    catch { /* skip inaccessible shapes */ }
                }

                // Scan headers and footers
                foreach (Section section in doc.Sections)
                {
                    try
                    {
                        foreach (HeaderFooter header in section.Headers)
                        {
                            ScanRange(header.Range, "Header", candidates);
                        }
                    }
                    catch { /* skip */ }

                    try
                    {
                        foreach (HeaderFooter footer in section.Footers)
                        {
                            ScanRange(footer.Range, "Footer", candidates);
                        }
                    }
                    catch { /* skip */ }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WordBatchLatexScanner] Scan error: {ex.Message}");
        }

        return candidates;
    }

    private void ScanRange(Range range, string location, List<LatexCandidateDto> candidates)
    {
        try
        {
            string text = range.Text ?? "";
            if (string.IsNullOrWhiteSpace(text)) return;

            var matches = LatexMathPattern.Matches(text);
            int matchIndex = 0;

            foreach (Match match in matches)
            {
                matchIndex++;
                // Determine which group captured
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
        catch { /* skip unreadable ranges */ }
    }
}
