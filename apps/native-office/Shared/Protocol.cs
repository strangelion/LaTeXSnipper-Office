using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Protocol constants for LaTeXSnipper Native Office v3.
/// Must match the Rust pipe_protocol.rs definitions.
/// </summary>
public static class NativeOfficeProtocol
{
    public const int Version = 3;
    public const string PipePrefix = "LaTeXSnipper.NativeOffice.v3";
    public const string CustomXmlNamespace = "urn:latexsnipper:native-office:v3";
}

// ---------------------------------------------------------------------------
// VSTO -> Desktop messages
// ---------------------------------------------------------------------------

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(VstoHello), "HELLO")]
[JsonDerivedType(typeof(VstoHostReady), "HOST_READY")]
[JsonDerivedType(typeof(VstoOpenEditor), "OPEN_EDITOR")]
[JsonDerivedType(typeof(VstoReadSelection), "READ_SELECTION")]
[JsonDerivedType(typeof(VstoReadTable), "READ_TABLE")]
[JsonDerivedType(typeof(VstoInsertResult), "INSERT_RESULT")]
[JsonDerivedType(typeof(VstoReplaceResult), "REPLACE_RESULT")]
[JsonDerivedType(typeof(VstoDeleteResult), "DELETE_RESULT")]
[JsonDerivedType(typeof(VstoHostError), "HOST_ERROR")]
public abstract class VstoMessage
{
    [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = "";
}

public class VstoHello : VstoMessage
{
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; }
    [JsonPropertyName("dpapiSecret")] public string DpapiSecret { get; set; } = "";
    [JsonPropertyName("hostType")] public string HostType { get; set; } = "";
    [JsonPropertyName("hostVersion")] public string HostVersion { get; set; } = "";
    [JsonPropertyName("windowHandle")] public ulong? WindowHandle { get; set; }
}

public class VstoHostReady : VstoMessage
{
    [JsonPropertyName("hostType")] public string HostType { get; set; } = "";
    [JsonPropertyName("hostVersion")] public string HostVersion { get; set; } = "";
    [JsonPropertyName("documentId")] public string? DocumentId { get; set; }
}

public class VstoOpenEditor : VstoMessage { }

public class VstoReadSelection : VstoMessage
{
    [JsonPropertyName("formula")] public FormulaPayload? Formula { get; set; }
    [JsonPropertyName("rangeXml")] public string? RangeXml { get; set; }
}

public class VstoReadTable : VstoMessage
{
    [JsonPropertyName("table")] public TablePayload? Table { get; set; }
    [JsonPropertyName("tableXml")] public string? TableXml { get; set; }
}

public class VstoInsertResult : VstoMessage
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("formulaId")] public string? FormulaId { get; set; }
    [JsonPropertyName("rangeStart")] public uint? RangeStart { get; set; }
    [JsonPropertyName("rangeEnd")] public uint? RangeEnd { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public class VstoReplaceResult : VstoMessage
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public class VstoDeleteResult : VstoMessage
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public class VstoHostError : VstoMessage
{
    [JsonPropertyName("error")] public string Error { get; set; } = "";
    [JsonPropertyName("errorCode")] public string? ErrorCode { get; set; }
}

// ---------------------------------------------------------------------------
// Desktop -> VSTO messages
// ---------------------------------------------------------------------------

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(DesktopHelloAck), "HELLO_ACK")]
[JsonDerivedType(typeof(DesktopHelloNack), "HELLO_NACK")]
[JsonDerivedType(typeof(DesktopPing), "PING")]
[JsonDerivedType(typeof(DesktopInsertFormula), "INSERT_FORMULA")]
[JsonDerivedType(typeof(DesktopReplaceFormula), "REPLACE_FORMULA")]
[JsonDerivedType(typeof(DesktopInsertTable), "INSERT_TABLE")]
[JsonDerivedType(typeof(DesktopRequestReadSelection), "REQUEST_READ_SELECTION")]
[JsonDerivedType(typeof(DesktopRequestReadTable), "REQUEST_READ_TABLE")]
[JsonDerivedType(typeof(DesktopDeleteCurrent), "DELETE_CURRENT")]
[JsonDerivedType(typeof(DesktopFormatSelection), "FORMAT_SELECTION")]
[JsonDerivedType(typeof(DesktopFormatAll), "FORMAT_ALL")]
[JsonDerivedType(typeof(DesktopRenumberWord), "RENUMBER_WORD")]
[JsonDerivedType(typeof(DesktopInsertWordReference), "INSERT_WORD_REFERENCE")]
public abstract class DesktopMessage
{
    [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = "";
}

public class DesktopHelloAck : DesktopMessage
{
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; }
}

public class DesktopHelloNack : DesktopMessage
{
    [JsonPropertyName("errorCode")] public string ErrorCode { get; set; } = "";
    [JsonPropertyName("error")] public string Error { get; set; } = "";
}

public class DesktopPing : DesktopMessage { }

public class DesktopInsertFormula : DesktopMessage
{
    [JsonPropertyName("formula")] public FormulaPayload Formula { get; set; } = new();
    [JsonPropertyName("mode")] public InsertMode Mode { get; set; }
}

public class DesktopReplaceFormula : DesktopMessage
{
    [JsonPropertyName("formulaId")] public string FormulaId { get; set; } = "";
    [JsonPropertyName("formula")] public FormulaPayload Formula { get; set; } = new();
}

public class DesktopInsertTable : DesktopMessage
{
    [JsonPropertyName("table")] public TablePayload Table { get; set; } = new();
}

public class DesktopDeleteCurrent : DesktopMessage
{
    [JsonPropertyName("formulaId")] public string? FormulaId { get; set; }
}

public class DesktopFormatSelection : DesktopMessage
{
    [JsonPropertyName("options")] public FormatOptions Options { get; set; } = new();
}

public class DesktopFormatAll : DesktopMessage
{
    [JsonPropertyName("options")] public FormatOptions Options { get; set; } = new();
}

public class DesktopRenumberWord : DesktopMessage
{
    [JsonPropertyName("startFrom")] public uint? StartFrom { get; set; }
}

public class DesktopInsertWordReference : DesktopMessage
{
    [JsonPropertyName("formulaId")] public string FormulaId { get; set; } = "";
    [JsonPropertyName("referenceType")] public string ReferenceType { get; set; } = "";
}

public class DesktopRequestReadSelection : DesktopMessage { }

public class DesktopRequestReadTable : DesktopMessage { }

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

public class FormulaPayload
{
    [JsonPropertyName("formulaId")] public string FormulaId { get; set; } = "";
    [JsonPropertyName("latex")] public string Latex { get; set; } = "";
    [JsonPropertyName("omml")] public string Omml { get; set; } = "";
    [JsonPropertyName("display")] public string Display { get; set; } = "block";
    [JsonPropertyName("presentation")] public PresentationData? Presentation { get; set; }
    [JsonPropertyName("render")] public RenderData? Render { get; set; }
    [JsonPropertyName("source")] public SourceInfo? Source { get; set; }
}

public class PresentationData
{
    [JsonPropertyName("alignment")] public string Alignment { get; set; } = "center";
    [JsonPropertyName("fontScale")] public float FontScale { get; set; } = 1.0f;
    [JsonPropertyName("color")] public string Color { get; set; } = "#000000";
}

public class RenderData
{
    [JsonPropertyName("svg")] public string? Svg { get; set; }
    [JsonPropertyName("widthPt")] public float WidthPt { get; set; }
    [JsonPropertyName("heightPt")] public float HeightPt { get; set; }
}

public class SourceInfo
{
    [JsonPropertyName("coreVersion")] public string CoreVersion { get; set; } = "";
    [JsonPropertyName("converterVersion")] public string ConverterVersion { get; set; } = "";
    [JsonPropertyName("ommlSha256")] public string OmmlSha256 { get; set; } = "";
}

public class TablePayload
{
    [JsonPropertyName("tableId")] public string TableId { get; set; } = "";
    [JsonPropertyName("table")] public TableBlock Table { get; set; } = new();
    /// Formula payloads referenced by formulaRef in cells.
    /// Key is formulaId, value is the full FormulaPayload.
    [JsonPropertyName("formulas")] public Dictionary<string, FormulaPayload>? Formulas { get; set; }
}

public class TableBlock
{
    [JsonPropertyName("rows")] public List<TableRow> Rows { get; set; } = new();
    [JsonPropertyName("properties")] public TableProperties? Properties { get; set; }
}

public class TableRow
{
    [JsonPropertyName("cells")] public List<TableCell> Cells { get; set; } = new();
}

public class TableCell
{
    [JsonPropertyName("rowspan")] public uint Rowspan { get; set; } = 1;
    [JsonPropertyName("colspan")] public uint Colspan { get; set; } = 1;
    [JsonPropertyName("inlines")] public List<InlineContent> Inlines { get; set; } = new();
    [JsonPropertyName("properties")] public CellProperties? Properties { get; set; }
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(InlineText), "text")]
[JsonDerivedType(typeof(InlineFormula), "formula")]
public abstract class InlineContent { }

public class InlineText : InlineContent
{
    [JsonPropertyName("text")] public string Text { get; set; } = "";
}

public class InlineFormula : InlineContent
{
    [JsonPropertyName("formulaRef")] public string FormulaRef { get; set; } = "";
    /// Optional inline formula payload for direct insertion.
    [JsonPropertyName("formula")] public FormulaPayload? Formula { get; set; }
}

public class TableProperties
{
    [JsonPropertyName("layout")] public string? Layout { get; set; }
}

public class CellProperties
{
    [JsonPropertyName("alignment")] public string? Alignment { get; set; }
    [JsonPropertyName("verticalAlignment")] public string? VerticalAlignment { get; set; }
    [JsonPropertyName("background")] public string? Background { get; set; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum InsertMode
{
    Inline,
    Display,
    DisplayNumbered
}

public class FormatOptions
{
    [JsonPropertyName("fontFamily")] public string? FontFamily { get; set; }
    [JsonPropertyName("fontSize")] public float? FontSize { get; set; }
    [JsonPropertyName("fontColor")] public string? FontColor { get; set; }
}
