// BatchConversionDtos.cs — Shared DTOs for batch conversion (Desktop ↔ VSTO).
//
// Consolidates types that were previously duplicated across Word/Excel/PowerPoint
// executors. All three hosts reference this single definition.

#nullable enable
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>Plan sent from Desktop to VSTO for batch execution.</summary>
public sealed class BatchConversionPlanDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("items")] public List<BatchConversionItem> Items { get; set; } = new();
}

/// <summary>A single item in a batch conversion plan.</summary>
public sealed class BatchConversionItem
{
    [JsonPropertyName("sourceId")] public string SourceId { get; set; } = "";
    [JsonPropertyName("sourceText")] public string SourceText { get; set; } = "";
    [JsonPropertyName("normalizedLatex")] public string NormalizedLatex { get; set; } = "";
    [JsonPropertyName("omml")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Omml { get; set; }
    [JsonPropertyName("locator")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? Locator { get; set; }
    [JsonPropertyName("sourceHash")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceHash { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "pending";
    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; set; }
}
