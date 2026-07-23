// IMathInsertionAdapter.cs — Unified Office Math insertion interface.
//
// All host adapters (Word, Excel, PowerPoint) implement this interface
// to provide editable Office Math equation insertion through a common API.
// The Desktop never depends on host-specific insertion logic.

#nullable enable
using System;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Input for inserting a math equation into an Office host.
/// </summary>
public sealed class MathInput
{
    /// <summary>Content format: "latex", "omml", "mathml".</summary>
    public string Format { get; set; } = "latex";

    /// <summary>The equation content.</summary>
    public string Content { get; set; } = "";

    /// <summary>Display mode: "inline", "display".</summary>
    public string Display { get; set; } = "inline";

    /// <summary>Optional formula identifier.</summary>
    public string? FormulaId { get; set; }

    /// <summary>Optional LaTeX source (for round-trip).</summary>
    public string? OriginalLatex { get; set; }
}

/// <summary>
/// Result of inserting a math equation.
/// </summary>
public sealed class InsertMathResult
{
    public bool Success { get; set; }
    public string? FormulaId { get; set; }
    public string? Error { get; set; }
    public string? ErrorCode { get; set; }

    public static InsertMathResult Succeeded(string? formulaId = null) =>
        new() { Success = true, FormulaId = formulaId };

    public static InsertMathResult Failed(string error, string? errorCode = null) =>
        new() { Success = false, Error = error, ErrorCode = errorCode };
}

/// <summary>
/// Unified Office Math insertion adapter.
///
/// Each host implements this to provide editable equation insertion.
/// The Desktop calls this via the pipe protocol command InsertMathEquation.
/// </summary>
public interface IMathInsertionAdapter
{
    /// <summary>
    /// Insert an editable math equation into the host document.
    /// </summary>
    InsertMathResult Insert(MathInput input);
}

/// <summary>
/// Read result for a math equation.
/// </summary>
public sealed class ReadMathResult
{
    public bool Success { get; set; }
    public string? FormulaId { get; set; }
    public string? Latex { get; set; }
    public string? Omml { get; set; }
    public string? Error { get; set; }

    public static ReadMathResult Succeeded(string? formulaId = null, string? latex = null, string? omml = null) =>
        new() { Success = true, FormulaId = formulaId, Latex = latex, Omml = omml };

    public static ReadMathResult Failed(string error) =>
        new() { Success = false, Error = error };
}
