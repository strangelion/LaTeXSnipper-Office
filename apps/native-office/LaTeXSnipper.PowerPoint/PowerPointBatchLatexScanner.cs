// PowerPointBatchLatexScanner.cs — Batch LaTeX detection for PowerPoint.
//
// Generates stable typed locators:
//   Shape text → PptTextRangeLocator (slideId + shapeId + start/length)
//   Table cell → PptTableCellLocator (slideId + shapeId + row/col + start/length)
//   Group child → PptGroupTextRangeLocator

#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPoint = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

internal sealed class PowerPointBatchLatexScanner
{
    private readonly PowerPoint.Application _application;

    private static readonly Regex LatexMathPattern = new(
        @"(?<!\\)(?:\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\])",
        RegexOptions.Singleline | RegexOptions.Compiled);

    public PowerPointBatchLatexScanner(PowerPoint.Application application) => _application = application;

    public List<LatexCandidateDto> Scan(string scope = "entirePresentation")
    {
        var candidates = new List<LatexCandidateDto>();
        try
        {
            var pres = _application.ActivePresentation;
            if (pres == null) return candidates;

            var slides = ResolveSlides(pres, scope.ToLowerInvariant());
            foreach (PowerPoint.Slide slide in slides)
            {
                int slideNum;
                try { slideNum = slide.SlideNumber; } catch { slideNum = 0; }
                int slideId;
                try { slideId = slide.SlideID; } catch { slideId = slideNum; }
                ScanSlide(slide, slideId, slideNum, candidates);
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
        switch (scope)
        {
            case "currentslide":
                if (_application.ActiveWindow?.View?.Slide is PowerPoint.Slide s)
                    slides.Add(s);
                break;
            case "selection":
                if (_application.ActiveWindow?.Selection?.SlideRange is PowerPoint.SlideRange sr)
                    for (int i = 1; i <= sr.Count; i++) slides.Add(sr[i]);
                break;
            case "selectedslides":
                // Fix: case must be lowercase after ToLowerInvariant()
                if (_application.ActiveWindow?.Selection?.SlideRange is PowerPoint.SlideRange selRange)
                    for (int i = 1; i <= selRange.Count; i++) slides.Add(selRange[i]);
                else if (_application.ActiveWindow?.View?.Slide is PowerPoint.Slide fs)
                    slides.Add(fs);
                break;
            case "entirepresentation":
            default:
                foreach (PowerPoint.Slide slide in pres.Slides) slides.Add(slide);
                break;
        }
        return slides;
    }

    private void ScanSlide(PowerPoint.Slide slide, int slideId, int slideNum,
        List<LatexCandidateDto> candidates)
    {
        string slideLabel = $"Slide {slideNum}";

        foreach (PowerPoint.Shape shape in slide.Shapes)
        {
            try
            {
                // Shape text
                if (shape.HasTextFrame == Microsoft.Office.Core.MsoTriState.msoTrue)
                {
                    var textRange = shape.TextFrame.TextRange;
                    if (textRange != null && !string.IsNullOrWhiteSpace(textRange.Text))
                    {
                        ScanText(textRange.Text, matchIndex => new PptTextRangeLocator
                        {
                            SlideId = slideId,
                            ShapeId = shape.Id,
                            Start = 0, Length = 0,
                        }, $"{slideLabel}/{shape.Name}", candidates,
                        (loc, m) => { var l = (PptTextRangeLocator)loc; l.Start = m.Index; l.Length = m.Length; });
                    }
                }

                // Table cells
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
                                    ScanText(cellText, matchIndex => new PptTableCellLocator
                                    {
                                        SlideId = slideId, ShapeId = shape.Id,
                                        Row = row, Column = col, Start = 0, Length = 0,
                                    }, $"{slideLabel}/Table/{shape.Name}({row},{col})", candidates,
                                    (loc, m) => { var l = (PptTableCellLocator)loc; l.Start = m.Index; l.Length = m.Length; });
                                }
                            }
                            catch { }
                        }
                    }
                }

                // Group shapes
                if (shape.Type == Microsoft.Office.Core.MsoShapeType.msoGroup)
                    ScanGroupShape(shape, slideId, slideLabel, candidates);
            }
            catch { }
        }
    }

    private void ScanGroupShape(PowerPoint.Shape group, int slideId, string location,
        List<LatexCandidateDto> candidates)
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
                        {
                            ScanText(text, matchIndex => new PptGroupTextRangeLocator
                            {
                                SlideId = slideId, GroupShapeId = group.Id,
                                ChildShapeId = child.Id, Start = 0, Length = 0,
                            }, $"{location}/Group/{group.Name}/{child.Name}", candidates,
                            (loc, m) => { var l = (PptGroupTextRangeLocator)loc; l.Start = m.Index; l.Length = m.Length; });
                        }
                    }
                }
                catch { }
            }
        }
        catch { }
    }

    private void ScanText(string text, Func<int, object> locatorFactory, string location,
        List<LatexCandidateDto> candidates, Action<object, Match> fillPosition)
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

            string source = match.Value.Trim();
            string sourceHash = ComputeSha256(source);
            var locator = locatorFactory(matchIndex);
            fillPosition(locator, match);

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

    private static string ComputeSha256(string input) => SourceHash.Sha256Hex(input);
}
