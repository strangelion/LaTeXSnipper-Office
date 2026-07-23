// PowerPointBatchLatexScanner.cs — Batch LaTeX detection for PowerPoint.
//
// Scans: TextBox, Placeholder, Shape Text, Table Cells
// Scope: Selection, CurrentSlide, SelectedSlides, EntirePresentation

#nullable enable
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPoint = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

/// <summary>
/// Scans PowerPoint presentations for LaTeX math expressions.
/// </summary>
internal sealed class PowerPointBatchLatexScanner
{
    private readonly PowerPoint.Application _application;

    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

    public PowerPointBatchLatexScanner(PowerPoint.Application application)
    {
        _application = application;
    }

    /// <summary>
    /// Scan for LaTeX candidates.
    /// </summary>
    /// <param name="scope">
    /// "selection", "currentSlide", "selectedSlides", "entirePresentation"
    /// </param>
    public List<LatexCandidateDto> Scan(string scope = "entirePresentation")
    {
        var candidates = new List<LatexCandidateDto>();

        try
        {
            var pres = _application.ActivePresentation;
            if (pres == null) return candidates;

            var slides = ResolveSlides(pres, scope);
            foreach (PowerPoint.Slide slide in slides)
            {
                int slideNum;
                try { slideNum = slide.SlideNumber; } catch { slideNum = 0; }
                ScanSlide(slide, slideNum, candidates);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PPTBatchLatexScanner] Scan error: {ex.Message}");
        }

        return candidates;
    }

    private List<PowerPoint.Slide> ResolveSlides(PowerPoint.Presentation pres, string scope)
    {
        var slides = new List<PowerPoint.Slide>();

        switch (scope.ToLowerInvariant())
        {
            case "currentslide":
                if (_application.ActiveWindow?.View?.Slide is PowerPoint.Slide slide)
                    slides.Add(slide);
                break;

            case "selection":
                if (_application.ActiveWindow?.Selection?.SlideRange is PowerPoint.SlideRange sr)
                {
                    for (int i = 1; i <= sr.Count; i++)
                        slides.Add(sr[i]);
                }
                break;

            case "selectedslides":
            case "entirepresentation":
            default:
                foreach (PowerPoint.Slide s in pres.Slides)
                    slides.Add(s);
                break;
        }

        return slides;
    }

    private void ScanSlide(PowerPoint.Slide slide, int slideNum, List<LatexCandidateDto> candidates)
    {
        string slideLabel = $"Slide {slideNum}";

        foreach (PowerPoint.Shape shape in slide.Shapes)
        {
            try
            {
                // Check if shape has text
                if (shape.HasTextFrame == Microsoft.Office.Core.MsoTriState.msoTrue)
                {
                    var textRange = shape.TextFrame.TextRange;
                    if (textRange != null)
                    {
                        string text = textRange.Text ?? "";
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            ScanText(text, $"{slideLabel}/Shape '{shape.Name}'", candidates);
                        }
                    }
                }

                // Check table cells
                if (shape.HasTable == Microsoft.Office.Core.MsoTriState.msoTrue)
                {
                    var table = shape.Table;
                    for (int row = 1; row <= table.Rows.Count; row++)
                    {
                        for (int col = 1; col <= table.Columns.Count; col++)
                        {
                            try
                            {
                                var cellText = table.Cell(row, col).Shape.TextFrame.TextRange.Text;
                                if (!string.IsNullOrWhiteSpace(cellText))
                                {
                                    ScanText(cellText,
                                        $"{slideLabel}/Table '{shape.Name}'/Cell({row},{col})",
                                        candidates);
                                }
                            }
                            catch { /* skip inaccessible cells */ }
                        }
                    }
                }

                // Check group shapes recursively
                if (shape.Type == Microsoft.Office.Core.MsoShapeType.msoGroup)
                {
                    ScanGroupShape(shape, slideLabel, candidates);
                }
            }
            catch { /* skip inaccessible shapes */ }
        }
    }

    private void ScanGroupShape(PowerPoint.Shape group, string location, List<LatexCandidateDto> candidates)
    {
        try
        {
            foreach (PowerPoint.Shape child in group.GroupItems)
            {
                try
                {
                    if (child.HasTextFrame == Microsoft.Office.Core.MsoTriState.msoTrue)
                    {
                        var text = child.TextFrame.TextRange?.Text;
                        if (!string.IsNullOrWhiteSpace(text))
                            ScanText(text, $"{location}/Group '{group.Name}'/Shape '{child.Name}'", candidates);
                    }
                }
                catch { /* skip */ }
            }
        }
        catch { /* skip */ }
    }

    private void ScanText(string text, string location, List<LatexCandidateDto> candidates)
    {
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

            candidates.Add(new LatexCandidateDto
            {
                Id = $"latex-{location.GetHashCode():x8}-{matchIndex:x4}",
                Source = match.Value.Trim(),
                NormalizedLatex = latex.Trim(),
                Location = $"{location}/{matchIndex}",
                Confidence = 0.95,
            });
        }
    }
}
