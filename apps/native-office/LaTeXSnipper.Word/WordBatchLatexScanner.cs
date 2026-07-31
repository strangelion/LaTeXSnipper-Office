// WordBatchLatexScanner.cs — Batch LaTeX detection for Word documents.
//
// Generates stable typed locators for every candidate:
//   Body text → WordRangeLocator (storyType + start/end)
//   TextBox/Shape → WordTextFrameLocator (shapeName + start/end)
//   Header/Footer → WordRangeLocator

#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Latex;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host;

internal sealed class WordBatchLatexScanner
{
    private readonly Application _application;

    public WordBatchLatexScanner(Application application) => _application = application;

    public List<LatexCandidateDto> Scan(string scope = "entireDocument")
    {
        var candidates = new List<LatexCandidateDto>();
        try
        {
            var doc = _application.ActiveDocument;
            if (doc == null) return candidates;

            if (scope.Equals("selection", StringComparison.OrdinalIgnoreCase))
            {
                ScanRange(_application.Selection.Range, "Selection", WdStoryType.wdMainTextStory, candidates);
            }
            else
            {
                ScanRange(doc.Content, "Body", WdStoryType.wdMainTextStory, candidates);

                foreach (Shape shape in doc.Shapes)
                {
                    try
                    {
                        if (shape.TextFrame.HasText != 0)
                            ScanShapeTextRange(shape.TextFrame.TextRange, shape.Name, candidates);
                    }
                    catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
                }

                var scannedHeaderFooters = new HashSet<string>(StringComparer.Ordinal);
                foreach (Section section in doc.Sections)
                {
                    int secIdx = section.Index;
                    try
                    {
                        foreach (HeaderFooter h in section.Headers)
                        {
                            try
                            {
                                if (!ShouldScanHeaderFooter(h, secIdx, scannedHeaderFooters)) continue;
                                WdStoryType st = h.Range.StoryType;
                                ScanRange(h.Range, $"Hdr-S{secIdx}", st, candidates, secIdx);
                            }
                            catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
                        }
                    }
                    catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
                    try
                    {
                        foreach (HeaderFooter f in section.Footers)
                        {
                            try
                            {
                                if (!ShouldScanHeaderFooter(f, secIdx, scannedHeaderFooters)) continue;
                                WdStoryType st = f.Range.StoryType;
                                ScanRange(f.Range, $"Ftr-S{secIdx}", st, candidates, secIdx);
                            }
                            catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
                        }
                    }
                    catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WordBatchLatexScanner] Scan error: {ex.Message}");
        }
        return candidates;
    }

    private void ScanRange(Range range, string location, WdStoryType storyType, List<LatexCandidateDto> candidates, int sectionIndex = 0)
    {
        try
        {
            string text = range.Text ?? "";
            if (string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = range.Start;
            var matches = LatexDelimiterScanner.Scan(text);
            int matchIndex = 0;

            foreach (LatexDelimiterMatch match in matches)
            {
                matchIndex++;
                string latex = match.Latex;
                string source = match.OriginalText;
                string sourceHash = ComputeSha256(source);

                var locator = new WordRangeLocator
                {
                    StoryType = (int)storyType,
                    SectionIndex = sectionIndex,
                    StoryIndex = 0,
                    Start = rangeStart + match.Offset,
                    End = rangeStart + match.Offset + match.Length,
                };

                candidates.Add(new LatexCandidateDto
                {
                    Id = $"latex-{location.GetHashCode():x8}-{matchIndex:x4}",
                    Source = source,
                    NormalizedLatex = latex,
                    Location = $"{location}/{matchIndex}",
                    Locator = JsonSerializer.SerializeToElement(locator),
                    SourceHash = sourceHash,
                    Confidence = 0.95,
                });
            }
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private void ScanShapeTextRange(Range textRange, string shapeName, List<LatexCandidateDto> candidates)
    {
        try
        {
            string text = textRange.Text ?? "";
            if (string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = textRange.Start;
            var matches = LatexDelimiterScanner.Scan(text);
            int matchIndex = 0;

            foreach (LatexDelimiterMatch match in matches)
            {
                matchIndex++;
                string latex = match.Latex;
                string source = match.OriginalText;
                string sourceHash = ComputeSha256(source);

                var locator = new WordTextFrameLocator
                {
                    ShapeName = shapeName,
                    Start = rangeStart + match.Offset,
                    End = rangeStart + match.Offset + match.Length,
                };

                candidates.Add(new LatexCandidateDto
                {
                    Id = $"latex-tb-{shapeName.GetHashCode():x8}-{matchIndex:x4}",
                    Source = source,
                    NormalizedLatex = latex,
                    Location = $"TextBox '{shapeName}'/{matchIndex}",
                    Locator = JsonSerializer.SerializeToElement(locator),
                    SourceHash = sourceHash,
                    Confidence = 0.95,
                });
            }
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private static bool ShouldScanHeaderFooter(HeaderFooter item, int sectionIndex, HashSet<string> seen)
    {
        try
        {
            if (!item.Exists) return false;
            if (sectionIndex > 1 && item.LinkToPrevious) return false;
            var range = item.Range;
            string key = $"{(int)range.StoryType}:{range.Start}:{range.End}";
            return seen.Add(key);
        }
        catch (System.Runtime.InteropServices.COMException) { return false; }
    }

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);
}
