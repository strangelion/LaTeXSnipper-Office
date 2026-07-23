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
                WdStoryType storyType = (WdStoryType)loc.StoryType;
                target = doc.StoryRanges[storyType];
                if (target == null) return false;

                // For header/footer stories with SectionIndex > 0, navigate
                // to the correct section's story range via NextStoryRange
                if (loc.SectionIndex > 1)
                {
                    for (int i = 1; i < loc.SectionIndex; i++)
                    {
                        try { target = target.NextStoryRange; }
                        catch { break; }
                        if (target == null) break;
                    }
                }

                if (target != null)
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
                        target = shape.TextFrame.TextRange;
                        target.SetRange(loc.Start, loc.End);
                        break;
                    }
                }
                if (target == null) return false;
            }
            else
            {
                return TryReplaceByFind(doc, item);
            }

            originalText = target.Text;

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

            // Transactional replacement: backup original text
            string backupText = originalText;
            Range? backupRange = target.Duplicate;

            try
            {
                target.Text = "";
                target.InsertXML(item.Omml!);
                return true;
            }
            catch (Exception ex)
            {
                // Restore original text on failure
                try { backupRange.Text = backupText; }
                catch (System.Runtime.InteropServices.COMException) { /* inaccessible */ }
                System.Diagnostics.Debug.WriteLine(
                    $"[WordBatchConversion] OMML insert failed, restored original: {ex.Message}");
                return false;
            }
        }
        catch (Exception)
        {
            return false;
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

        string backupText = range.Text;
        try
        {
            range.Text = "";
            range.InsertXML(item.Omml!);
            return true;
        }
        catch (Exception ex)
        {
            try { range.Text = backupText; } catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
            System.Diagnostics.Debug.WriteLine(
                $"[WordBatchConversion] Find-fallback failed: {ex.Message}");
            return false;
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
