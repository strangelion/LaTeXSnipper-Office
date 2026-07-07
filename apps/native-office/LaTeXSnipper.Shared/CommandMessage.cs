#nullable enable
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Unified command message — mirrors core-protocol/command.schema.ts.
/// This is the application-layer command format that all hosts (Office, WPS,
/// Obsidian, VSTO) share. It travels over the named pipe alongside the
/// existing DesktopMessage / VstoMessage types.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(CommandMessage.InsertFormula), "InsertFormula")]
[JsonDerivedType(typeof(CommandMessage.ReplaceSelection), "ReplaceSelection")]
[JsonDerivedType(typeof(CommandMessage.GetSelection), "GetSelection")]
[JsonDerivedType(typeof(CommandMessage.ConvertToOMML), "ConvertToOMML")]
[JsonDerivedType(typeof(CommandMessage.ConvertToLaTeX), "ConvertToLaTeX")]
[JsonDerivedType(typeof(CommandMessage.RenderPreview), "RenderPreview")]
[JsonDerivedType(typeof(CommandMessage.DetectTable), "DetectTable")]
[JsonDerivedType(typeof(CommandMessage.FormatContent), "FormatContent")]
[JsonDerivedType(typeof(CommandMessage.OpenEditor), "OpenEditor")]
[JsonDerivedType(typeof(CommandMessage.OpenSettings), "OpenSettings")]
[JsonDerivedType(typeof(CommandMessage.ConvertFormula), "ConvertFormula")]
public abstract class CommandMessage
{
    [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";

    public class InsertFormula : CommandMessage
    {
        [JsonPropertyName("latex")] public string Latex { get; set; } = "";
        [JsonPropertyName("display")] public string Display { get; set; } = "inline";
        [JsonPropertyName("formulaId")] public string? FormulaId { get; set; }
    }

    public class ReplaceSelection : CommandMessage
    {
        [JsonPropertyName("content")] public string Content { get; set; } = "";
    }

    public class GetSelection : CommandMessage { }

    public class ConvertToOMML : CommandMessage
    {
        [JsonPropertyName("latex")] public string Latex { get; set; } = "";
    }

    public class ConvertToLaTeX : CommandMessage
    {
        [JsonPropertyName("omml")] public string Omml { get; set; } = "";
    }

    public class RenderPreview : CommandMessage
    {
        [JsonPropertyName("latex")] public string Latex { get; set; } = "";
        [JsonPropertyName("format")] public string Format { get; set; } = "svg";
    }

    public class DetectTable : CommandMessage { }

    public class FormatContent : CommandMessage
    {
        [JsonPropertyName("fontFamily")] public string? FontFamily { get; set; }
        [JsonPropertyName("fontSize")] public float? FontSize { get; set; }
        [JsonPropertyName("color")] public string? Color { get; set; }
    }

    public class OpenEditor : CommandMessage { }
    public class OpenSettings : CommandMessage { }

    public class ConvertFormula : CommandMessage
    {
        [JsonPropertyName("formulaId")] public string FormulaId { get; set; } = "";
        [JsonPropertyName("targetMode")] public string TargetMode { get; set; } = "ole";
    }
}

/// <summary>
/// Unified command result — mirrors core-protocol/command.schema.ts CommandResult.
/// </summary>
public class CommandResultMessage
{
    [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("data")] public string? Data { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }

    public static CommandResultMessage Success(string requestId, string? data = null) =>
        new() { RequestId = requestId, Ok = true, Data = data };

    public static CommandResultMessage Failure(string requestId, string error) =>
        new() { RequestId = requestId, Ok = false, Error = error };
}
