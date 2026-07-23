// PowerPointBatchConversionExecutor.cs — Batch LaTeX → Office Math for PowerPoint.
//
// Consumes locators to find exact shapes/cells on correct slides.
// No longer depends on ActiveWindow/ActiveSlide.
// Insert-first-then-delete pattern prevents data loss.

#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPoint = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

internal sealed class PowerPointBatchConversionExecutor
{
    private readonly PowerPoint.Application _application;

    public PowerPointBatchConversionExecutor(PowerPoint.Application application) => _application = application;

    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var pres = _application.ActivePresentation;
        if (pres == null)
            return BuildResult(planId, total, 0, 0, total,
                items.ConvertAll(i => Failure(i, "No active presentation")));

        // Sort within same shape by start DESC (reverse order)
        var ordered = items.OrderByDescending(i => GetLocatorStart(i)).ToList();

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
                bool ok = TryReplaceWithLocator(pres, item);
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

    private bool TryReplaceWithLocator(PowerPoint.Presentation pres, BatchConversionItem item)
    {
        if (item.Locator == null) return TryReplaceByFind(pres, item);

        string kind = GetLocatorKind(item.Locator.Value);
        string raw = item.Locator.Value.GetRawText();

        return kind switch
        {
            "pptTextRange" => ReplaceInShapeText(pres, JsonSerializer.Deserialize<PptTextRangeLocator>(raw), item),
            "pptTableCell" => ReplaceInTableCell(pres, JsonSerializer.Deserialize<PptTableCellLocator>(raw), item),
            "pptGroupTextRange" => ReplaceInGroupShape(pres, JsonSerializer.Deserialize<PptGroupTextRangeLocator>(raw), item),
            _ => TryReplaceByFind(pres, item),
        };
    }

    private bool ReplaceInShapeText(PowerPoint.Presentation pres, PptTextRangeLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PowerPoint.Shape shape in slide.Shapes)
        {
            if (shape.Id != loc.ShapeId) continue;
            if (shape.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) return false;

            var textRange = shape.TextFrame.TextRange;
            if (textRange == null || loc.Start + loc.Length > textRange.Text.Length) return false;

            string currentLatex = textRange.Text.Substring(loc.Start, loc.Length);
            if (!string.IsNullOrEmpty(item.SourceHash) &&
                !string.Equals(ComputeSha256(currentLatex), item.SourceHash, StringComparison.OrdinalIgnoreCase))
                return false;

            // Activate the correct slide, then insert-first-then-delete
            slide.Select();
            var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
            var mathAdapter = new PowerPointMathAdapter(_application);
            var result = mathAdapter.Insert(new MathInput
            {
                Format = "omml", Content = item.Omml!,
                Display = "inline", FormulaId = $"batch-{item.SourceId}",
                OriginalLatex = item.NormalizedLatex,
            });

            if (!result.Success) return false;
            foundRange.Delete();
            return true;
        }
        return false;
    }

    private bool ReplaceInTableCell(PowerPoint.Presentation pres, PptTableCellLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PowerPoint.Shape shape in slide.Shapes)
        {
            if (shape.Id != loc.ShapeId || shape.HasTable != Microsoft.Office.Core.MsoTriState.msoTrue)
                continue;

            try
            {
                var cellShape = shape.Table.Cell(loc.Row, loc.Column).Shape;
                var textRange = cellShape.TextFrame.TextRange;
                if (textRange == null || loc.Start + loc.Length > textRange.Text.Length) return false;

                string currentLatex = textRange.Text.Substring(loc.Start, loc.Length);
                if (!string.IsNullOrEmpty(item.SourceHash) &&
                    !string.Equals(ComputeSha256(currentLatex), item.SourceHash, StringComparison.OrdinalIgnoreCase))
                    return false;

                slide.Select();
                var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
                var mathAdapter = new PowerPointMathAdapter(_application);
                var result = mathAdapter.Insert(new MathInput
                {
                    Format = "omml", Content = item.Omml!,
                    Display = "inline", FormulaId = $"batch-{item.SourceId}",
                    OriginalLatex = item.NormalizedLatex,
                });

                if (!result.Success) return false;
                foundRange.Delete();
                return true;
            }
            catch { }
        }
        return false;
    }

    private bool ReplaceInGroupShape(PowerPoint.Presentation pres, PptGroupTextRangeLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PowerPoint.Shape shape in slide.Shapes)
        {
            if (shape.Id != loc.GroupShapeId || shape.Type != Microsoft.Office.Core.MsoShapeType.msoGroup)
                continue;

            foreach (PowerPoint.Shape child in shape.GroupItems)
            {
                if (child.Id != loc.ChildShapeId) continue;
                if (child.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) return false;

                var textRange = child.TextFrame.TextRange;
                if (textRange == null || loc.Start + loc.Length > textRange.Text.Length) return false;

                string currentLatex = textRange.Text.Substring(loc.Start, loc.Length);
                if (!string.IsNullOrEmpty(item.SourceHash) &&
                    !string.Equals(ComputeSha256(currentLatex), item.SourceHash, StringComparison.OrdinalIgnoreCase))
                    return false;

                slide.Select();
                var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
                var mathAdapter = new PowerPointMathAdapter(_application);
                var result = mathAdapter.Insert(new MathInput
                {
                    Format = "omml", Content = item.Omml!,
                    Display = "inline", FormulaId = $"batch-{item.SourceId}",
                    OriginalLatex = item.NormalizedLatex,
                });

                if (!result.Success) return false;
                foundRange.Delete();
                return true;
            }
        }
        return false;
    }

    private bool TryReplaceByFind(PowerPoint.Presentation pres, BatchConversionItem item)
    {
        foreach (PowerPoint.Slide slide in pres.Slides)
        {
            foreach (PowerPoint.Shape shape in slide.Shapes)
            {
                try
                {
                    if (shape.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) continue;
                    var tr = shape.TextFrame.TextRange;
                    if (tr == null) continue;
                    int idx = tr.Text.IndexOf(item.SourceText, StringComparison.Ordinal);
                    if (idx < 0) continue;

                    slide.Select();
                    var found = tr.Characters(idx + 1, item.SourceText.Length);
                    var mathAdapter = new PowerPointMathAdapter(_application);
                    var result = mathAdapter.Insert(new MathInput
                    {
                        Format = "omml", Content = item.Omml!,
                        Display = "inline", FormulaId = $"batch-{item.SourceId}",
                        OriginalLatex = item.NormalizedLatex,
                    });
                    if (!result.Success) return false;
                    found.Delete();
                    return true;
                }
                catch { }
            }
        }
        return false;
    }

    private static PowerPoint.Slide? FindSlide(PowerPoint.Presentation pres, int slideId)
    {
        foreach (PowerPoint.Slide slide in pres.Slides)
        {
            try { if (slide.SlideID == slideId) return slide; } catch { }
        }
        return null;
    }

    private static int GetLocatorStart(BatchConversionItem item)
    {
        if (item.Locator == null) return 0;
        try
        {
            if (item.Locator.Value.TryGetProperty("start", out var s) && s.TryGetInt32(out int v))
                return v;
        }
        catch { }
        return 0;
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
