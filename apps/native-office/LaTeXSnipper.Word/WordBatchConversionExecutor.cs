// WordBatchConversionExecutor.cs — Batch LaTeX → OMML conversion for Word.
//
// Consumes host-generated locators to find the exact source position.
// Verifies sourceHash before replacing. Executes in reverse start order
// (within each story) so earlier positions are not invalidated.

#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using OmmlValidator = LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidator;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host;

internal sealed class WordBatchConversionExecutor
{
    private readonly Application _application;

    public WordBatchConversionExecutor(Application application) => _application = application;

    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var doc = _application.ActiveDocument;
        if (doc == null)
            return BuildResult(planId, total, 0, 0, total,
                items.ConvertAll(i => Failure(i, "No active document")));

        // Sort: items within the same story by start DESC (reverse order)
        // so earlier positions remain valid after later replacements.
        var ordered = items
            .OrderByDescending(i => GetLocatorStart(i))
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
                bool ok = TryReplaceWithLocator(doc, item);
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

    /// <summary>Resolve the locator, verify sourceHash, and replace with OMML.</summary>
    private bool TryReplaceWithLocator(Document doc, BatchConversionItem item)
    {
        Range? target = null;
        string originalText = "";

        if (item.Locator == null)
        {
            // Fallback for legacy items without locator: use Find (less reliable)
            return TryReplaceByFind(doc, item);
        }

        try
        {
            var locJson = item.Locator.Value.GetRawText();
            string? kind = GetLocatorKind(item.Locator.Value);

            if (kind == "wordRange")
            {
                var loc = JsonSerializer.Deserialize<WordRangeLocator>(locJson);
                if (loc == null) return false;
                target = ResolveWordStory(doc, loc);
                if (target == null || loc.Start < target.Start || loc.End > target.End || loc.End <= loc.Start)
                    return false;
                target.SetRange(loc.Start, loc.End);
            }
            else if (kind == "wordTextFrame")
            {
                var loc = JsonSerializer.Deserialize<WordTextFrameLocator>(locJson);
                if (loc == null) return false;
                // Find the shape by name
                foreach (Shape shape in doc.Shapes)
                {
                    if (shape.Name == loc.ShapeName && shape.TextFrame.HasText != 0)
                    {
                        target = shape.TextFrame.TextRange.Duplicate;
                        if (loc.Start < target.Start || loc.End > target.End || loc.End <= loc.Start)
                            return false;
                        target.SetRange(loc.Start, loc.End);
                        break;
                    }
                }
                if (target == null) return false;
            }
            else
            {
                // An unknown typed locator must never silently target the first
                // matching formula in an unrelated story.
                return false;
            }

            if (target == null) return false;
            originalText = target.Text;
            if (!string.Equals(originalText, item.SourceText, StringComparison.Ordinal))
                return false;

            // Verify sourceHash if available
            if (!string.IsNullOrEmpty(item.SourceHash))
            {
                string currentHash = ComputeSha256(originalText);
                if (!string.Equals(currentHash, item.SourceHash, StringComparison.OrdinalIgnoreCase))
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"[WordBatchConversion] SOURCE_CHANGED for {item.SourceId}: hash mismatch");
                    return false;
                }
            }

            return ReplaceStory(doc, target, item);
        }
        catch (Exception exception)
        {
            OfficeOperationLog.Failure("batch-replace-story", "word", item.SourceId, exception);
            return false;
        }
        finally
        {
            if (target != null) System.Runtime.InteropServices.Marshal.ReleaseComObject(target);
        }
    }

    private static Range? ResolveWordStory(Document doc, WordRangeLocator locator)
    {
        var story = (WdStoryType)locator.StoryType;
        if (story == WdStoryType.wdMainTextStory) return doc.Content.Duplicate;
        if (locator.SectionIndex < 1 || locator.SectionIndex > doc.Sections.Count) return null;
        var section = doc.Sections[locator.SectionIndex];
        HeaderFooter? item = null;
        try
        {
            item = story switch
            {
                WdStoryType.wdPrimaryHeaderStory => section.Headers[WdHeaderFooterIndex.wdHeaderFooterPrimary],
                WdStoryType.wdFirstPageHeaderStory => section.Headers[WdHeaderFooterIndex.wdHeaderFooterFirstPage],
                WdStoryType.wdEvenPagesHeaderStory => section.Headers[WdHeaderFooterIndex.wdHeaderFooterEvenPages],
                WdStoryType.wdPrimaryFooterStory => section.Footers[WdHeaderFooterIndex.wdHeaderFooterPrimary],
                WdStoryType.wdFirstPageFooterStory => section.Footers[WdHeaderFooterIndex.wdHeaderFooterFirstPage],
                WdStoryType.wdEvenPagesFooterStory => section.Footers[WdHeaderFooterIndex.wdHeaderFooterEvenPages],
                _ => null
            };
            return item != null && item.Exists ? item.Range.Duplicate : null;
        }
        finally
        {
            if (item != null) System.Runtime.InteropServices.Marshal.ReleaseComObject(item);
            System.Runtime.InteropServices.Marshal.ReleaseComObject(section);
        }
    }

    /// <summary>Legacy fallback: find by source text (no locator available).</summary>
    private bool TryReplaceByFind(Document doc, BatchConversionItem item)
    {
        var find = doc.Content.Find;
        find.Text = item.SourceText;
        find.Forward = true;
        find.Wrap = WdFindWrap.wdFindStop;
        if (!find.Execute()) return false;

        var range = doc.Content.Duplicate;
        range.Find.Execute(FindText: item.SourceText, Forward: true, Wrap: WdFindWrap.wdFindStop);
        if (!range.Find.Found) return false;

        return ReplaceStory(doc, range, item);
    }

    private bool ReplaceStory(Document doc, Range source, BatchConversionItem item)
    {
        if (!OmmlValidator.Validate(item.Omml).IsValid) return false;
        if (!string.IsNullOrEmpty(item.SourceHash) &&
            !string.Equals(ComputeSha256(source.Text), item.SourceHash, StringComparison.OrdinalIgnoreCase))
            return false;

        int start = source.Start;
        int end = source.End;
        string formulaId = FormulaIdHelper.NewId();
        var adapter = new WordAdapter(_application);
        // Keep the source until the existing, validated inline pipeline commits.
        // Raw OMML InsertXML is not reliable in the middle of a Word paragraph.
        var anchor = source.Duplicate;
        anchor.SetRange(end, end);
        bool inserted;
        try
        {
            anchor.Select();
            var insertion = adapter.InsertFormula(new FormulaPayload
            {
                FormulaId = formulaId,
                Latex = item.NormalizedLatex,
                Omml = item.Omml,
                StorageMode = "native-omml",
                Display = "inline"
            }, InsertMode.Inline);
            inserted = insertion.Success;
            if (!inserted) throw new InvalidOperationException(insertion.Error ?? "Native inline insertion failed.");
        }
        finally
        {
            System.Runtime.InteropServices.Marshal.ReleaseComObject(anchor);
        }
        if (!inserted) return false;
        try
        {
            source.SetRange(start, end);
            source.Delete();
            return true;
        }
        catch
        {
            adapter.DeleteFormula(formulaId);
            throw;
        }
    }

    private static int GetLocatorStart(BatchConversionItem item)
    {
        if (item.Locator == null) return 0;
        try
        {
            var json = item.Locator.Value;
            if (json.TryGetProperty("start", out var start) && start.TryGetInt32(out int s))
                return s;
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
        return 0;
    }

    private static string? GetLocatorKind(System.Text.Json.JsonElement loc)
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
