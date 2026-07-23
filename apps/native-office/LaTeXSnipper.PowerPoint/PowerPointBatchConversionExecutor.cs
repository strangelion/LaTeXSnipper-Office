// PowerPointBatchConversionExecutor.cs — Batch LaTeX → OMML conversion for PowerPoint.

#nullable enable
using System;
using System.Collections.Generic;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPoint = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

/// <summary>
/// Executes a batch conversion plan on the active PowerPoint presentation.
/// </summary>
internal sealed class PowerPointBatchConversionExecutor
{
    private readonly PowerPoint.Application _application;

    public PowerPointBatchConversionExecutor(PowerPoint.Application application)
    {
        _application = application;
    }

    /// <summary>
    /// Execute batch conversion. Replaces LaTeX source text with Office Math equations.
    /// Each converted item places an anchored OLE/OMath object on its source slide.
    /// </summary>
    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var pres = _application.ActivePresentation;
        if (pres == null)
        {
            return BuildResult(planId, total, 0, 0, total,
                items.ConvertAll(i => new BatchFailureDto
                { SourceId = i.SourceId, SourceText = i.SourceText, Error = "No active presentation" }));
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
                bool found = ReplaceTextWithMath(pres, item);
                if (found)
                    converted++;
                else
                {
                    skipped++;
                    failures.Add(new BatchFailureDto
                    {
                        SourceId = item.SourceId,
                        SourceText = item.SourceText,
                        Error = "LaTeX source not found in presentation"
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

    private bool ReplaceTextWithMath(PowerPoint.Presentation pres, BatchConversionItem item)
    {
        var mathAdapter = new PowerPointMathAdapter(_application);

        foreach (PowerPoint.Slide slide in pres.Slides)
        {
            foreach (PowerPoint.Shape shape in slide.Shapes)
            {
                try
                {
                    if (shape.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue)
                        continue;

                    var textRange = shape.TextFrame.TextRange;
                    if (textRange == null) continue;

                    string text = textRange.Text ?? "";
                    int idx = text.IndexOf(item.SourceText, StringComparison.Ordinal);
                    if (idx < 0) continue;

                    // Found the LaTeX source — replace with OMML equation
                    // Delete the LaTeX text
                    var foundRange = textRange.Characters(idx + 1, item.SourceText.Length);
                    foundRange.Delete();

                    // Insert Office Math via OLE
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
                catch { /* try next shape */ }
            }
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
