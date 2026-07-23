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
using PptInterop = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

internal sealed class PowerPointBatchConversionExecutor
{
    private readonly PptInterop.Application _application;

    public PowerPointBatchConversionExecutor(PptInterop.Application application) => _application = application;

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

    private bool TryReplaceWithLocator(PptInterop.Presentation pres, BatchConversionItem item)
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

    private bool ReplaceInShapeText(PptInterop.Presentation pres, PptTextRangeLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PptInterop.Shape shape in slide.Shapes)
        {
            if (shape.Id != loc.ShapeId) continue;
            if (shape.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) return false;

            var textRange = shape.TextFrame.TextRange;
            if (textRange == null || loc.Start + loc.Length > textRange.Text.Length) return false;

            string currentLatex = textRange.Text.Substring(loc.Start, loc.Length);
            if (!string.IsNullOrEmpty(item.SourceHash) &&
                !string.Equals(ComputeSha256(currentLatex), item.SourceHash, StringComparison.OrdinalIgnoreCase))
                return false;

            // Insert against explicit slide target (no slide.Select dependency)
            var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
            var mathAdapter = new PowerPointMathAdapter(_application);
            var result = mathAdapter.Insert(new MathInput
            {
                Format = "omml", Content = item.Omml!,
                Display = "inline", FormulaId = $"batch-{item.SourceId}",
                OriginalLatex = item.NormalizedLatex,
            }, new PowerPointMathTarget
            {
                Slide = slide,
                Left = shape.Left,
                Top = shape.Top,
            });

            if (!result.Success) return false;
            foundRange.Delete();
            return true;
        }
        return false;
    }

    private bool ReplaceInTableCell(PptInterop.Presentation pres, PptTableCellLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PptInterop.Shape shape in slide.Shapes)
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

                // Using explicit slide target
                var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
                var mathAdapter = new PowerPointMathAdapter(_application);
                var result = mathAdapter.Insert(new MathInput
                {
                    Format = "omml", Content = item.Omml!,
                    Display = "inline", FormulaId = $"batch-{item.SourceId}",
                    OriginalLatex = item.NormalizedLatex,
                }, BuildTextRangeTarget(slide, foundRange));

                if (!result.Success) return false;
                foundRange.Delete();
                return true;
            }
            catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
        }
        return false;
    }

    private bool ReplaceInGroupShape(PptInterop.Presentation pres, PptGroupTextRangeLocator? loc,
        BatchConversionItem item)
    {
        if (loc == null) return false;
        var slide = FindSlide(pres, loc.SlideId);
        if (slide == null) return false;

        foreach (PptInterop.Shape shape in slide.Shapes)
        {
            if (shape.Id != loc.GroupShapeId || shape.Type != Microsoft.Office.Core.MsoShapeType.msoGroup)
                continue;

            foreach (PptInterop.Shape child in shape.GroupItems)
            {
                if (child.Id != loc.ChildShapeId) continue;
                if (child.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) return false;

                var textRange = child.TextFrame.TextRange;
                if (textRange == null || loc.Start + loc.Length > textRange.Text.Length) return false;

                string currentLatex = textRange.Text.Substring(loc.Start, loc.Length);
                if (!string.IsNullOrEmpty(item.SourceHash) &&
                    !string.Equals(ComputeSha256(currentLatex), item.SourceHash, StringComparison.OrdinalIgnoreCase))
                    return false;

                // Using explicit slide target
                var foundRange = textRange.Characters(loc.Start + 1, loc.Length);
                var mathAdapter = new PowerPointMathAdapter(_application);
                var result = mathAdapter.Insert(new MathInput
                {
                    Format = "omml", Content = item.Omml!,
                    Display = "inline", FormulaId = $"batch-{item.SourceId}",
                    OriginalLatex = item.NormalizedLatex,
                }, BuildTextRangeTarget(slide, foundRange));

                if (!result.Success) return false;
                foundRange.Delete();
                return true;
            }
        }
        return false;
    }

    private bool TryReplaceByFind(PptInterop.Presentation pres, BatchConversionItem item)
    {
        foreach (PptInterop.Slide slide in pres.Slides)
        {
            foreach (PptInterop.Shape shape in slide.Shapes)
            {
                try
                {
                    if (shape.HasTextFrame != Microsoft.Office.Core.MsoTriState.msoTrue) continue;
                    var tr = shape.TextFrame.TextRange;
                    if (tr == null) continue;
                    int idx = tr.Text.IndexOf(item.SourceText, StringComparison.Ordinal);
                    if (idx < 0) continue;

                    // Using explicit slide target
                    var found = tr.Characters(idx + 1, item.SourceText.Length);
                    var mathAdapter = new PowerPointMathAdapter(_application);
                    var result = mathAdapter.Insert(new MathInput
                    {
                        Format = "omml", Content = item.Omml!,
                        Display = "inline", FormulaId = $"batch-{item.SourceId}",
                        OriginalLatex = item.NormalizedLatex,
                    }, BuildTextRangeTarget(slide, foundRange));
                    if (!result.Success) return false;
                    found.Delete();
                    return true;
                }
                catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
            }
        }
        return false;
    }

    private static PptInterop.Slide? FindSlide(PptInterop.Presentation pres, int slideId)
    {
        foreach (PptInterop.Slide slide in pres.Slides)
        {
            try { if (slide.SlideID == slideId) return slide; } catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
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
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
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

    private static PowerPointMathTarget BuildTextRangeTarget(PptInterop.Slide slide, PptInterop.TextRange range)
    {
        return new PowerPointMathTarget
        {
            Slide = slide,
            Left = range.BoundLeft,
            Top = range.BoundTop,
            Width = Math.Max(1f, range.BoundWidth),
            Height = Math.Max(1f, range.BoundHeight),
        };
    }

    private static VstoBatchConvertResult BuildResult(
        string planId, int total, int converted, int skipped, int failed,
        List<BatchFailureDto> failures) =>
        new()
        {
            PlanId = planId, Total = total, Converted = converted,
            Skipped = skipped, Failed = failed, Failures = failures,
        };
}
