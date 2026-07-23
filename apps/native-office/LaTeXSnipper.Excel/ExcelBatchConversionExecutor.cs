// ExcelBatchConversionExecutor.cs — Batch LaTeX → Office Math conversion for Excel.

#nullable enable
using System;
using System.Collections.Generic;
using LaTeXSnipper.NativeOffice.Shared;
using Excel = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

/// <summary>
/// Executes a batch conversion plan on the active Excel workbook.
/// </summary>
internal sealed class ExcelBatchConversionExecutor
{
    private readonly Excel.Application _application;

    public ExcelBatchConversionExecutor(Excel.Application application)
    {
        _application = application;
    }

    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var wb = _application.ActiveWorkbook;
        if (wb == null)
        {
            return BuildResult(planId, total, 0, 0, total,
                items.ConvertAll(i => new BatchFailureDto
                { SourceId = i.SourceId, SourceText = i.SourceText, Error = "No active workbook" }));
        }

        foreach (var item in items)
        {
            if (item.Status != "converted" || string.IsNullOrEmpty(item.Omml))
            {
                skipped++;
                failures.Add(new BatchFailureDto
                {
                    SourceId = item.SourceId,
                    SourceText = item.SourceText,
                    Error = item.Error ?? "No OMML content"
                });
                continue;
            }

            try
            {
                bool found = ReplaceCellLatexWithMath(wb, item);
                if (found)
                    converted++;
                else
                {
                    skipped++;
                    failures.Add(new BatchFailureDto
                    {
                        SourceId = item.SourceId,
                        SourceText = item.SourceText,
                        Error = "LaTeX source not found in workbook"
                    });
                }
            }
            catch (Exception ex)
            {
                failed++;
                failures.Add(new BatchFailureDto
                {
                    SourceId = item.SourceId,
                    SourceText = item.SourceText,
                    Error = ex.Message
                });
            }
        }

        return BuildResult(planId, total, converted, skipped, failed, failures);
    }

    private bool ReplaceCellLatexWithMath(Excel.Workbook wb, BatchConversionItem item)
    {
        foreach (Excel.Worksheet sheet in wb.Worksheets)
        {
            try
            {
                var usedRange = sheet.UsedRange;
                if (usedRange == null) continue;

                var find = usedRange.Find(
                    item.SourceText,
                    Type.Missing,
                    Excel.XlFindLookIn.xlValues,
                    Excel.XlLookAt.xlPart,
                    Excel.XlSearchOrder.xlByRows,
                    Excel.XlSearchDirection.xlNext,
                    false);

                if (find != null)
                {
                    var cell = find as Excel.Range;
                    if (cell != null)
                    {
                        // Activate the found cell so the adapter targets the right location
                        cell.Activate();

                        // Add OMML as anchored object at the cell location
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
                        return result.Success;
                    }
                }
            }
            catch { /* try next sheet */ }
        }

        return false;
    }

    private static VstoBatchConvertResult BuildResult(
        string planId, int total, int converted, int skipped, int failed,
        List<BatchFailureDto> failures) =>
        new()
        {
            PlanId = planId,
            Total = total,
            Converted = converted,
            Skipped = skipped,
            Failed = failed,
            Failures = failures,
        };
}
