// BatchLocator.cs — Host-specific stable source locators for batch conversion.
//
// Each host generates a locator when scanning. The Desktop stores it without
// interpretation and passes it back to the host during execution. This avoids
// re-searching by source text (which breaks with duplicate formulas).

#nullable enable
using System;
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

// =========================================================================
// Word locators
// =========================================================================

/// <summary>Locator for text in the main document body (story).</summary>
public sealed class WordRangeLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "wordRange";
    /// <summary>WdStoryType value.</summary>
    [JsonPropertyName("storyType")] public int StoryType { get; set; }
    [JsonPropertyName("storyIndex")] public int StoryIndex { get; set; }
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("end")] public int End { get; set; }
}

/// <summary>Locator for text inside a Word shape/text frame.</summary>
public sealed class WordTextFrameLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "wordTextFrame";
    [JsonPropertyName("shapeName")] public string ShapeName { get; set; } = "";
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("end")] public int End { get; set; }
}

// =========================================================================
// Excel locators
// =========================================================================

/// <summary>Locator for LaTeX inside an Excel cell.</summary>
public sealed class ExcelCellLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "excelCell";
    [JsonPropertyName("worksheet")] public string Worksheet { get; set; } = "";
    /// <summary>Absolute cell address, e.g. "$AB$17".</summary>
    [JsonPropertyName("address")] public string Address { get; set; } = "";
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("length")] public int Length { get; set; }
}

/// <summary>Locator for LaTeX inside an Excel shape/text box.</summary>
public sealed class ExcelShapeLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "excelShape";
    [JsonPropertyName("worksheet")] public string Worksheet { get; set; } = "";
    [JsonPropertyName("shapeName")] public string ShapeName { get; set; } = "";
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("length")] public int Length { get; set; }
}

// =========================================================================
// PowerPoint locators
// =========================================================================

/// <summary>Locator for LaTeX inside a PowerPoint shape's text range.</summary>
public sealed class PptTextRangeLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "pptTextRange";
    [JsonPropertyName("slideId")] public int SlideId { get; set; }
    [JsonPropertyName("shapeId")] public int ShapeId { get; set; }
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("length")] public int Length { get; set; }
}

/// <summary>Locator for LaTeX inside a PowerPoint table cell.</summary>
public sealed class PptTableCellLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "pptTableCell";
    [JsonPropertyName("slideId")] public int SlideId { get; set; }
    [JsonPropertyName("shapeId")] public int ShapeId { get; set; }
    [JsonPropertyName("row")] public int Row { get; set; }
    [JsonPropertyName("column")] public int Column { get; set; }
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("length")] public int Length { get; set; }
}

/// <summary>Locator for LaTeX inside a grouped shape's child text.</summary>
public sealed class PptGroupTextRangeLocator
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "pptGroupTextRange";
    [JsonPropertyName("slideId")] public int SlideId { get; set; }
    [JsonPropertyName("groupShapeId")] public int GroupShapeId { get; set; }
    [JsonPropertyName("childShapeId")] public int ChildShapeId { get; set; }
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("length")] public int Length { get; set; }
}
