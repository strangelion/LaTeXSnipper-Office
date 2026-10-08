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
    private readonly Document? _targetDocument;

    public WordBatchLatexScanner(Application application, Document? targetDocument = null)
    {
        _application = application; _targetDocument = targetDocument;
    }

    public List<LatexCandidateDto> Scan(string scope = "entireDocument")
    {
        bool rawSelection = scope.Equals("selection-latex", StringComparison.OrdinalIgnoreCase);
        if (_targetDocument != null && !scope.Equals("entireDocument", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Explicit document scanning requires entireDocument scope.", nameof(scope));
        if (!rawSelection && !scope.Equals("selection", StringComparison.OrdinalIgnoreCase) &&
            !scope.Equals("entireDocument", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Unsupported Word scan scope.", nameof(scope));
        var candidates = new List<LatexCandidateDto>();
        try
        {
            var doc = _targetDocument ?? _application.ActiveDocument;
            if (doc == null) return candidates;

            if (rawSelection || scope.Equals("selection", StringComparison.OrdinalIgnoreCase))
            {
                var selected = _application.Selection.Range;
                if (selected.StoryType == WdStoryType.wdTextFrameStory)
                {
                    foreach (Shape shape in doc.Shapes)
                    {
                        try
                        {
                            if (shape.TextFrame.HasText != 0 && selected.InRange(shape.TextFrame.TextRange))
                            {
                                ScanShapeTextRange(selected, shape.Name, candidates, rawSelection);
                                break;
                            }
                        }
                        catch (System.Runtime.InteropServices.COMException exception)
                        {
                            OfficeOperationLog.Failure("scan-selected-text-frame", "word", null, exception);
                        }
                    }
                }
                else
                {
                    int sectionIndex = selected.StoryType == WdStoryType.wdMainTextStory
                        ? 0 : selected.Sections[1].Index;
                    ScanRange(selected, "Selection", selected.StoryType, candidates, sectionIndex, rawSelection);
                }
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
            if (rawSelection) throw; // Host reports the actionable rejection, not an empty successful scan.
        }
        return candidates;
    }

    private void ScanRange(Range range, string location, WdStoryType storyType, List<LatexCandidateDto> candidates, int sectionIndex = 0, bool rawSelection = false)
    {
        try
        {
            string text = range.Text ?? "";
            if (rawSelection && (range.OMaths.Count != 0 || range.ContentControls.Count != 0))
                throw new FormatException("Select plain LaTeX text, not an existing formula/content control.");
            if (!rawSelection && string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = range.Start;
            int searchStart = rangeStart;
            var matches = rawSelection ? LatexDelimiterScanner.ScanSelection(text) : LatexDelimiterScanner.Scan(text);
            int matchIndex = 0;

            foreach (LatexDelimiterMatch match in matches)
            {
                matchIndex++;
                string latex = match.Latex;
                string source = match.OriginalText;
                string sourceHash = ComputeSha256(source);
                var resolved = ResolveSourceRange(range, text, match, ref searchStart);
                if (resolved == null) continue;

                var locator = new WordRangeLocator
                {
                    StoryType = (int)storyType,
                    SectionIndex = sectionIndex,
                    StoryIndex = 0,
                    Start = resolved.Start,
                    End = resolved.End,
                };
                System.Runtime.InteropServices.Marshal.ReleaseComObject(resolved);

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
        catch (System.Runtime.InteropServices.COMException) when (!rawSelection) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private void ScanShapeTextRange(Range textRange, string shapeName, List<LatexCandidateDto> candidates, bool rawSelection = false)
    {
        try
        {
            string text = textRange.Text ?? "";
            if (rawSelection && (textRange.OMaths.Count != 0 || textRange.ContentControls.Count != 0))
                throw new FormatException("Select plain LaTeX text, not an existing formula/content control.");
            if (!rawSelection && string.IsNullOrWhiteSpace(text)) return;

            int rangeStart = textRange.Start;
            int searchStart = rangeStart;
            var matches = rawSelection ? LatexDelimiterScanner.ScanSelection(text) : LatexDelimiterScanner.Scan(text);
            int matchIndex = 0;

            foreach (LatexDelimiterMatch match in matches)
            {
                matchIndex++;
                string latex = match.Latex;
                string source = match.OriginalText;
                string sourceHash = ComputeSha256(source);
                var resolved = ResolveSourceRange(textRange, text, match, ref searchStart);
                if (resolved == null) continue;

                var locator = new WordTextFrameLocator
                {
                    ShapeName = shapeName,
                    Start = resolved.Start,
                    End = resolved.End,
                };
                System.Runtime.InteropServices.Marshal.ReleaseComObject(resolved);

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
        catch (System.Runtime.InteropServices.COMException) when (!rawSelection) { System.Diagnostics.Debug.WriteLine("Skipped: " + typeof(System.Runtime.InteropServices.COMException).Name); }
    }

    private static Range? ResolveSourceRange(Range scope, string text, LatexDelimiterMatch match, ref int searchStart)
    {
        // An exact whole-selection match already has authoritative Word bounds.
        // Do not run Word Find on bare backslash commands in that case.
        if (match.Offset == 0 && match.Length == text.Length &&
            string.Equals(scope.Text, match.OriginalText, StringComparison.Ordinal))
        {
            searchStart = scope.End;
            return scope.Duplicate;
        }
        // Floating drawing anchors consume Word positions but are omitted from
        // Range.Text. Numeric UTF-16 offsets alone can therefore target adjacent
        // prose. Resolve inside the exact story and verify the visible prefix as
        // well as source text (duplicate/commented formulas must not be retargeted).
        var probe = scope.Duplicate;
        probe.SetRange(searchStart, scope.End);
        try
        {
            // Stay below Word Find's length limit even after escaping carets.
            string needle = match.OriginalText.Length <= 120
                ? match.OriginalText : match.OriginalText.Substring(0, 120);
            // Even non-wildcard Word Find treats ^1, ^p etc. as special tokens.
            needle = needle.Replace("^", "^^");
            while (probe.Find.Execute(FindText: needle, MatchCase: true, MatchWholeWord: false,
                MatchWildcards: false, MatchSoundsLike: false, MatchAllWordForms: false,
                Forward: true, Wrap: WdFindWrap.wdFindStop, Format: false))
            {
                int next = probe.End;
                if (probe.Start + match.Length <= scope.End)
                {
                    probe.SetRange(probe.Start, probe.Start + match.Length);
                    var prefix = scope.Duplicate;
                    prefix.SetRange(scope.Start, probe.Start);
                    string prefixText = prefix.Text ?? "";
                    System.Runtime.InteropServices.Marshal.ReleaseComObject(prefix);
                    if (string.Equals(probe.Text, match.OriginalText, StringComparison.Ordinal) &&
                        string.Equals(prefixText, text.Substring(0, match.Offset), StringComparison.Ordinal))
                    {
                        searchStart = probe.End;
                        return probe.Duplicate;
                    }
                }
                if (next >= scope.End) break;
                probe.SetRange(next, scope.End);
            }
            return null;
        }
        finally { System.Runtime.InteropServices.Marshal.ReleaseComObject(probe); }
    }

    private static bool ShouldScanHeaderFooter(HeaderFooter item, int sectionIndex, HashSet<string> seen)
    {
        try
        {
            if (!item.Exists) return false;
            if (sectionIndex > 1 && item.LinkToPrevious) return false;
            var range = item.Range;
            // Independent sections can have identical offsets and lengths.
            // LinkToPrevious above, not matching range sizes, identifies sharing.
            string key = $"{sectionIndex}:{(int)range.StoryType}";
            return seen.Add(key);
        }
        catch (System.Runtime.InteropServices.COMException) { return false; }
    }

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);
}
