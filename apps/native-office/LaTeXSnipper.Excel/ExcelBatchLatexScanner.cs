// ExcelBatchLatexScanner.cs — Batch LaTeX detection for Excel workbooks.
//
// Generates stable typed locators:
//   Cell text → ExcelCellLocator (worksheet + address + start/length)
//   Shape text → ExcelShapeLocator (worksheet + shapeName + start/length)

#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using ExcelInterop = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

internal sealed class ExcelBatchLatexScanner
{
    private readonly ExcelInterop.Application _application;

    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

    public ExcelBatchLatexScanner(ExcelInterop.Application application) => _application = application;

    public List<LatexCandidateDto> Scan(string scope = "entireWorkbook")
    {
        var candidates = new List<LatexCandidateDto>();
        try
        {
            var wb = _application.ActiveWorkbook;
            if (wb == null) return candidates;

            if (scope.Equals("selection", StringComparison.OrdinalIgnoreCase))
            {
                if (_application.Selection is ExcelInterop.Range range)
                    ScanRange(range, candidates);
            }
            else if (scope.Equals("currentWorksheet", StringComparison.OrdinalIgnoreCase))
            {
                if (_application.ActiveSheet is ExcelInterop.Worksheet sheet)
                    ScanWorksheet(sheet, candidates);
            }
            else
            {
                foreach (ExcelInterop.Worksheet sheet in wb.Worksheets)
                    ScanWorksheet(sheet, candidates);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelBatchLatexScanner] Scan error: {ex.Message}");
        }
        return candidates;
    }

    private void ScanWorksheet(ExcelInterop.Worksheet sheet, List<LatexCandidateDto> candidates)
    {
        string sheetName;
        try { sheetName = sheet.Name; } catch { sheetName = "Unknown"; }

        try
        {
            var usedRange = sheet.UsedRange;
            if (usedRange != null) ScanRange(usedRange, candidates);
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }

        // Scan shapes with text
        try
        {
            foreach (ExcelInterop.Shape shape in sheet.Shapes)
            {
                try
                {
                    if (shape.TextFrame2 == null || shape.TextFrame2.HasText == 0)
                        continue;
                    var text = shape.TextFrame2.TextRange?.Text;
                    if (!string.IsNullOrEmpty(text))
                        ScanText(text, () => new ExcelShapeLocator
                        {
                            Worksheet = sheetName,
                            ShapeName = shape.Name,
                            Start = 0, // filled per-match
                            Length = 0,
                        }, $"{sheetName}/Shape '{shape.Name}'", candidates);
                }
                catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
            }
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private void ScanRange(ExcelInterop.Range range, List<LatexCandidateDto> candidates)
    {
        try
        {
            var value = range.Value;
            if (value == null) return;

            if (value is object[,] matrix)
            {
                int rows = matrix.GetLength(0);
                int cols = matrix.GetLength(1);
                for (int r = 1; r <= rows; r++)
                {
                    for (int c = 1; c <= cols; c++)
                    {
                        var cellValue = matrix[r, c]?.ToString();
                        if (string.IsNullOrEmpty(cellValue)) continue;

                        var cell = range.Worksheet.Cells[range.Row + r - 1, range.Column + c - 1] as ExcelInterop.Range;
                        string addr = cell?.Address[RowAbsolute: true, ColumnAbsolute: true, ReferenceStyle: ExcelInterop.XlReferenceStyle.xlA1]
                            ?? $"R{range.Row + r - 1}C{range.Column + c - 1}";
                        string sheetName;
                        try { sheetName = range.Worksheet.Name; } catch { sheetName = "Unknown"; }

                        var cellLoc = new ExcelCellLocator
                        {
                            Worksheet = sheetName,
                            Address = addr,
                            Start = 0, // filled per-match
                            Length = 0,
                        };

                        ScanText(cellValue, () => new ExcelCellLocator
                        {
                            Worksheet = cellLoc.Worksheet,
                            Address = cellLoc.Address,
                            Start = 0,
                            Length = 0,
                        }, $"{sheetName}/{addr}", candidates);
                    }
                }
            }
            else
            {
                string text = value.ToString() ?? "";
                if (!string.IsNullOrEmpty(text))
                {
                    string sheetName;
                    try { sheetName = range.Worksheet.Name; } catch { sheetName = "Unknown"; }
                    string addr = range.Address[RowAbsolute: true, ColumnAbsolute: true, ReferenceStyle: ExcelInterop.XlReferenceStyle.xlA1];
                    ScanText(text, () => new ExcelCellLocator
                    {
                        Worksheet = sheetName,
                        Address = addr,
                        Start = 0, Length = 0,
                    }, $"{sheetName}/{addr}", candidates);
                }
            }
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private void ScanText(string text, Func<object> locatorFactory, string location,
        List<LatexCandidateDto> candidates)
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

            string source = match.Value.Trim();
            string sourceHash = ComputeSha256(source);

            // Fill position details into the locator
            var locator = locatorFactory();
            if (locator is ExcelCellLocator cellLoc)
            {
                cellLoc.Start = match.Index;
                cellLoc.Length = match.Length;
            }
            else if (locator is ExcelShapeLocator shapeLoc)
            {
                shapeLoc.Start = match.Index;
                shapeLoc.Length = match.Length;
            }

            candidates.Add(new LatexCandidateDto
            {
                Id = $"latex-{location.GetHashCode():x8}-{matchIndex:x4}",
                Source = source,
                NormalizedLatex = latex.Trim(),
                Location = $"{location}/{matchIndex}",
                Locator = JsonSerializer.SerializeToElement(locator),
                SourceHash = sourceHash,
                Confidence = 0.95,
            });
        }
    }

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);
}
