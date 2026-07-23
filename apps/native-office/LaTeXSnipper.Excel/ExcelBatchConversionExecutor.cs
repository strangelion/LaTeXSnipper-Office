// ExcelBatchConversionExecutor.cs — Batch LaTeX → Office Math conversion for Excel.
//
// Consumes locators to find exact cells/shapes (no ActiveCell dependency).
// Verifies sourceHash. Supports replaceSource flag.

#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using ExcelInterop = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

internal sealed class ExcelBatchConversionExecutor
{
    private readonly ExcelInterop.Application _application;

    public ExcelBatchConversionExecutor(ExcelInterop.Application application) => _application = application;

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

        // Sort by container key then by start DESC for same-cell safety
        var ordered = items
            .OrderBy(i => GetContainerKey(i))
            .ThenByDescending(i => GetLocatorStart(i))
            .ToList();

        foreach (var item in ordered)
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

    private bool TryReplaceWithLocator(ExcelInterop.Workbook wb, BatchConversionItem item)
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

    private bool ReplaceInCell(ExcelInterop.Workbook wb, ExcelCellLocator loc, BatchConversionItem item)
    {
        try
        {
            var sheet = wb.Worksheets[loc.Worksheet] as ExcelInterop.Worksheet;
            if (sheet == null) return false;

            var cell = sheet.Range[loc.Address] as ExcelInterop.Range;
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

            // Insert math using EXPLICIT target (no ActiveCell dependency)
            var mathAdapter = new ExcelMathAdapter(_application);
            var mathInput = new MathInput
            {
                Format = "omml",
                Content = item.Omml!,
                Display = "inline",
                FormulaId = $"batch-{item.SourceId}",
                OriginalLatex = item.NormalizedLatex,
            };

            var result = mathAdapter.Insert(mathInput, new ExcelMathTarget
            {
                Worksheet = sheet,
                AnchorCell = cell,
            });
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

    private bool ReplaceInShape(ExcelInterop.Workbook wb, ExcelShapeLocator loc, BatchConversionItem item)
    {
        try
        {
            var sheet = wb.Worksheets[loc.Worksheet] as ExcelInterop.Worksheet;
            if (sheet == null) return false;

            foreach (ExcelInterop.Shape shape in sheet.Shapes)
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

    private bool TryReplaceByFind(ExcelInterop.Workbook wb, BatchConversionItem item)
    {
        foreach (ExcelInterop.Worksheet sheet in wb.Worksheets)
        {
            try
            {
                var usedRange = sheet.UsedRange;
                if (usedRange == null) continue;
                var find = usedRange.Find(item.SourceText, Type.Missing,
                    ExcelInterop.XlFindLookIn.xlValues, ExcelInterop.XlLookAt.xlPart,
                    ExcelInterop.XlSearchOrder.xlByRows, ExcelInterop.XlSearchDirection.xlNext, false);
                if (find is ExcelInterop.Range cell)
                {
                    string originalText = cell.Value?.ToString() ?? "";
                    int idx = originalText.IndexOf(item.SourceText, StringComparison.Ordinal);

                    var mathAdapter = new ExcelMathAdapter(_application);
                    bool ok = mathAdapter.Insert(new MathInput
                    {
                        Format = "omml", Content = item.Omml!,
                        Display = "inline", FormulaId = $"batch-{item.SourceId}",
                        OriginalLatex = item.NormalizedLatex,
                    }, new ExcelMathTarget { Worksheet = sheet, AnchorCell = cell }).Success;

                    if (ok && idx >= 0)
                    {
                        string before = originalText.Substring(0, idx);
                        string after = originalText.Substring(idx + item.SourceText.Length);
                        string newText = before + after;
                        cell.Value = string.IsNullOrWhiteSpace(newText) ? null : newText;
                    }
                    return ok;
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

    /// <summary>Group key for reverse-order sorting within same container.</summary>
    private static string GetContainerKey(BatchConversionItem item)
    {
        if (item.Locator == null) return "";
        var loc = item.Locator.Value;
        string kind = GetLocatorKind(loc) ?? "";
        string container = "";
        if (loc.TryGetProperty("worksheet", out var ws)) container += ws.GetString();
        if (loc.TryGetProperty("address", out var addr)) container += addr.GetString();
        if (loc.TryGetProperty("shapeName", out var sn)) container += sn.GetString();
        return kind + "/" + container;
    }

    private static int GetLocatorStart(BatchConversionItem item)
    {
        if (item.Locator == null) return 0;
        return item.Locator.Value.TryGetProperty("start", out var s) && s.TryGetInt32(out int v)
            ? v
            : 0;
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
