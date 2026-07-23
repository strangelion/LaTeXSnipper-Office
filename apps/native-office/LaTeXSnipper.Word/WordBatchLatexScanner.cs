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
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host;

internal sealed class WordBatchLatexScanner
{
    private readonly Application _application;

    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

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

                foreach (Section section in doc.Sections)
                {
                    int secIdx = section.Index;
                    try
                    {
                        foreach (HeaderFooter h in section.Headers)
                        {
                            try
                            {
                                WdStoryType st = h.Range.StoryType;
                                ScanRange(h.Range, $"Hdr-S{secIdx}", st, candidates);
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
                                WdStoryType st = f.Range.StoryType;
                                ScanRange(f.Range, $"Ftr-S{secIdx}", st, candidates);
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

    private void ScanRange(Range range, string location, WdStoryType storyType, List<LatexCandidateDto> candidates)
    {
        try
        {
            string text = range.Text ?? "";
            if (string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = range.Start;
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

                var locator = new WordRangeLocator
                {
                    StoryType = (int)storyType,
                    StoryIndex = 0,
                    Start = rangeStart + match.Index,
                    End = rangeStart + match.Index + match.Length,
                };

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
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private void ScanShapeTextRange(Range textRange, string shapeName, List<LatexCandidateDto> candidates)
    {
        try
        {
            string text = textRange.Text ?? "";
            if (string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = textRange.Start;
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

                var locator = new WordTextFrameLocator
                {
                    ShapeName = shapeName,
                    Start = rangeStart + match.Index,
                    End = rangeStart + match.Index + match.Length,
                };

                candidates.Add(new LatexCandidateDto
                {
                    Id = $"latex-tb-{shapeName.GetHashCode():x8}-{matchIndex:x4}",
                    Source = source,
                    NormalizedLatex = latex.Trim(),
                    Location = $"TextBox '{shapeName}'/{matchIndex}",
                    Locator = JsonSerializer.SerializeToElement(locator),
                    SourceHash = sourceHash,
                    Confidence = 0.95,
                });
            }
        }
        catch (System.Runtime.InteropServices.COMException) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);
}
