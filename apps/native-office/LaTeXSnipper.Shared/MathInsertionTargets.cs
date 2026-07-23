// MathInsertionTargets.cs — Explicit host-specific insertion targets.
//
// Batch conversion uses these to pass precise positions to math adapters
// instead of relying on ActiveCell/ActiveSlide/ActiveWindow state.

#nullable enable

namespace LaTeXSnipper.NativeOffice.Shared;

// =========================================================================
// Excel
// =========================================================================

/// <summary>Explicit target for inserting math into an Excel worksheet.</summary>
public sealed class ExcelMathTarget
{
    /// <summary>Target worksheet (not null after construction).</summary>
    public object Worksheet { get; init; } = null!;

    /// <summary>Anchor cell range (e.g., "B7").</summary>
    public object AnchorCell { get; init; } = null!;
}

// =========================================================================
// PowerPoint
// =========================================================================

/// <summary>Explicit target for inserting math onto a PowerPoint slide.</summary>
public sealed class PowerPointMathTarget
{
    /// <summary>Target slide object.</summary>
    public object Slide { get; init; } = null!;

    /// <summary>Left position in points.</summary>
    public float Left { get; init; }

    /// <summary>Top position in points.</summary>
    public float Top { get; init; }
}
