// ExcelBatchConversionExecutor.cs — Batch LaTeX → Office Math conversion for Excel.
//
// Consumes locators to find exact cells/shapes (no ActiveCell dependency).
// Verifies sourceHash. Supports replaceSource flag.

#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using Excel = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

internal sealed class ExcelBatchConversionExecutor
{
    private readonly Excel.Application _application;

    public ExcelBatchConversionExecutor(Excel.Application application) => _application = application;

    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var wb = _application.ActiveWorkbook;
        if (wb == null)
            return BuildResult(planId, total, 0, 0, total,
                items.ConvertAll(i => Failure(i, "No active workbook")));

        foreach (var item in items)
        {
            if (item.Status != "converted" || string.IsNullOrEmpty(item.Omml))
            {
                skipped++;
                failures.Add(Failure(item, item.Error ?? "No OMML content"));
                continue;
            }

            try
            {
                bool ok = TryReplaceWithLocator(wb, item);
                if (ok) converted++;
                else { skipped++; failures.Add(Failure(item, "Locator resolution failed")); }
            }
            catch (Exception ex)
            {
                failed++;
                failures.Add(Failure(item, ex.Message));
            }
        }

        return BuildResult(planId, total, converted, skipped, failed, failures);
    }

    private bool TryReplaceWithLocator(Excel.Workbook wb, BatchConversionItem item)
    {
        if (item.Locator == null) return TryReplaceByFind(wb, item);

        string kind = GetLocatorKind(item.Locator.Value);

        if (kind == "excelCell")
        {
            var loc = JsonSerializer.Deserialize<ExcelCellLocator>(
                item.Locator.Value.GetRawText());
            if (loc == null) return false;
            return ReplaceInCell(wb, loc, item);
        }
        else if (kind == "excelShape")
        {
            var loc = JsonSerializer.Deserialize<ExcelShapeLocator>(
                item.Locator.Value.GetRawText());
            if (loc == null) return false;
            return ReplaceInShape(wb, loc, item);
        }

        return TryReplaceByFind(wb, item);
    }

    private bool ReplaceInCell(Excel.Workbook wb, ExcelCellLocator loc, BatchConversionItem item)
    {
        try
        {
            var sheet = wb.Worksheets[loc.Worksheet] as Excel.Worksheet;
            if (sheet == null) return false;

            var cell = sheet.Range[loc.Address] as Excel.Range;
            if (cell == null) return false;

            string currentText = cell.Value?.ToString() ?? "";
            if (!string.IsNullOrEmpty(item.SourceHash))
            {
                // Extract the specific LaTeX substring
                string currentLatex = currentText.Length >= loc.Start + loc.Length
                    ? currentText.Substring(loc.Start, loc.Length)
                    : currentText;
                string currentHash = ComputeSha256(currentLatex);
                if (!string.Equals(currentHash, item.SourceHash, StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            // Insert math object at this cell (not ActiveCell)
            cell.Activate();
            var mathAdapter = new ExcelMathAdapter(_application);
            var mathInput = new MathInput
            {
                Format = "omml",
                Content = item.Omml!,
                Display = "inline",
                FormulaId = $"batch-{item.SourceId}",
                OriginalLatex = item.NormalizedLatex,
            };

            var result = mathAdapter.Insert(mathInput);
            if (!result.Success) return false;

            // Replace the LaTeX substring in the cell text with empty string
            if (loc.Start >= 0 && loc.Length > 0 && currentText.Length >= loc.Start + loc.Length)
            {
                string before = currentText.Substring(0, loc.Start);
                string after = currentText.Substring(loc.Start + loc.Length);
                string newText = before + after;
                // Only write if the replacement actually changes something
                if (newText != currentText)
                {
                    cell.Value = string.IsNullOrWhiteSpace(newText) ? null : newText;
                }
            }

            return true;
        }
        catch (System.Runtime.InteropServices.COMException) { return false; }
    }

    private bool ReplaceInShape(Excel.Workbook wb, ExcelShapeLocator loc, BatchConversionItem item)
    {
        try
        {
            var sheet = wb.Worksheets[loc.Worksheet] as Excel.Worksheet;
            if (sheet == null) return false;

            foreach (Excel.Shape shape in sheet.Shapes)
            {
                if (shape.Name != loc.ShapeName) continue;
                if (shape.TextFrame2 == null || shape.TextFrame2.HasText == 0) continue;

                string text = shape.TextFrame2.TextRange?.Text ?? "";
                if (loc.Start + loc.Length > text.Length) return false;

                string currentLatex = text.Substring(loc.Start, loc.Length);
                if (!string.IsNullOrEmpty(item.SourceHash))
                {
                    string currentHash = ComputeSha256(currentLatex);
                    if (!string.Equals(currentHash, item.SourceHash, StringComparison.OrdinalIgnoreCase))
                        return false;
                }

                // Insert math at shape position
                var mathAdapter = new ExcelMathAdapter(_application);
                var mathInput = new MathInput
                {
                    Format = "omml",
                    Content = item.Omml!,
                    Display = "inline",
                    FormulaId = $"batch-{item.SourceId}",
                    OriginalLatex = item.NormalizedLatex,
                };
                var result = mathAdapter.Insert(mathInput);
                if (!result.Success) return false;

                // Delete the LaTeX substring from shape text
                if (loc.Start >= 0 && loc.Length > 0 && text.Length >= loc.Start + loc.Length)
                {
                    string before = text.Substring(0, loc.Start);
                    string after = text.Substring(loc.Start + loc.Length);
                    shape.TextFrame2.TextRange.Text = before + after;
                }
                return true;
            }
            return false;
        }
        catch (System.Runtime.InteropServices.COMException) { return false; }
    }

    private bool TryReplaceByFind(Excel.Workbook wb, BatchConversionItem item)
    {
        foreach (Excel.Worksheet sheet in wb.Worksheets)
        {
            try
            {
                var usedRange = sheet.UsedRange;
                if (usedRange == null) continue;
                var find = usedRange.Find(item.SourceText, Type.Missing,
                    Excel.XlFindLookIn.xlValues, Excel.XlLookAt.xlPart,
                    Excel.XlSearchOrder.xlByRows, Excel.XlSearchDirection.xlNext, false);
                if (find is Excel.Range cell)
                {
                    cell.Activate();
                    var mathAdapter = new ExcelMathAdapter(_application);
                    return mathAdapter.Insert(new MathInput
                    {
                        Format = "omml", Content = item.Omml!,
                        Display = "inline", FormulaId = $"batch-{item.SourceId}",
                        OriginalLatex = item.NormalizedLatex,
                    }).Success;
                }
            }
            catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
        }
        return false;
    }

    private static string? GetLocatorKind(JsonElement loc)
    {
        if (loc.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String)
            return k.GetString();
        return null;
    }

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);

    private static BatchFailureDto Failure(BatchConversionItem item, string error) =>
        new() { SourceId = item.SourceId, SourceText = item.SourceText, Error = error };

    private static VstoBatchConvertResult BuildResult(
        string planId, int total, int converted, int skipped, int failed,
        List<BatchFailureDto> failures) =>
        new()
        {
            PlanId = planId, Total = total, Converted = converted,
            Skipped = skipped, Failed = failed, Failures = failures,
        };
}
