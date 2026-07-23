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
    public object Worksheet { get; set; } = null!;

    /// <summary>Anchor cell range (e.g., "B7").</summary>
    public object AnchorCell { get; set; } = null!;
}

// =========================================================================
// PowerPoint
// =========================================================================

/// <summary>Explicit target for inserting math onto a PowerPoint slide.</summary>
public sealed class PowerPointMathTarget
{
    /// <summary>Target slide object.</summary>
    public object Slide { get; set; } = null!;

    /// <summary>Left position in points.</summary>
    public float Left { get; set; }

    /// <summary>Top position in points.</summary>
    public float Top { get; set; }

    /// <summary>Width in points (0 = use default).</summary>
    public float Width { get; set; }

    /// <summary>Height in points (0 = use default).</summary>
    public float Height { get; set; }
}
