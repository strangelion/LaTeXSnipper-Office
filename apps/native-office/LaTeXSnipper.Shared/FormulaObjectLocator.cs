#nullable enable
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Identifies the exact location of a formula object within a host document.
/// Used by Manifest entries and Replace/Delete commands to avoid ambiguity.
/// </summary>
public class FormulaObjectLocator
{
    /// <summary>Word | excel | powerpoint</summary>
    [JsonPropertyName("host")]
    public string Host { get; set; } = "";

    /// <summary>For Excel: worksheet name; for PPT: slide index; for Word: empty</summary>
    [JsonPropertyName("container")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Container { get; set; }

    /// <summary>Object name as assigned by the host (e.g. "LSNO_{formulaId}")</summary>
    [JsonPropertyName("objectName")]
    public string ObjectName { get; set; } = "";

    /// <summary>ole | image | native-omml</summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    /// <summary>Build from a host type and formulaId.</summary>
    public static FormulaObjectLocator FromFormulaId(string host, string formulaId, string kind)
    {
        return new FormulaObjectLocator
        {
            Host = host,
            ObjectName = $"LSNO_{formulaId}",
            Kind = kind,
        };
    }
}
