// PowerPointMathAdapter.cs — Office Math equation insertion for PowerPoint.
//
// Provides editable Office Math equation insertion via OMML shapes.
// PowerPoint supports OMML-based equation objects natively.

#nullable enable
using System;
using LaTeXSnipper.NativeOffice.Shared;
using PptInterop = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.PowerPoint.Host;

/// <summary>
/// Provides editable Office Math equation insertion for PowerPoint.
/// Equations are inserted as native OMML shapes on the current slide.
/// </summary>
internal sealed class PowerPointMathAdapter : IMathInsertionAdapter
{
    private readonly PptInterop.Application _application;

    public PowerPointMathAdapter(PptInterop.Application application)
    {
        _application = application;
    }

    /// <inheritdoc/>
    public InsertMathResult Insert(MathInput input)
    {
        try
        {
            var pres = _application.ActivePresentation;
            if (pres == null)
                return InsertMathResult.Failed("No active presentation", "NO_ACTIVE_PRESENTATION");

            var slide = _application.ActiveWindow?.View?.Slide as PptInterop.Slide;
            if (slide == null)
                return InsertMathResult.Failed("No active slide", "NO_ACTIVE_SLIDE");

            string formulaId = input.FormulaId ?? Guid.NewGuid().ToString("N");
            string omml = input.Format switch
            {
                "omml" => input.Content,
                "latex" => throw new InvalidOperationException(
                    "LaTeX→OMML conversion must be performed by the Desktop first."),
                _ => throw new NotSupportedException($"Format '{input.Format}' is not supported.")
            };

            if (string.IsNullOrEmpty(omml))
                return InsertMathResult.Failed("OMML content is empty", "OMML_EMPTY");

            // For PowerPoint, the most reliable approach is OLE-based insertion
            // with OMML metadata stored in the object for round-trip editing.
            var payload = new FormulaPayload
            {
                SchemaVersion = 3,
                FormulaId = formulaId,
                Latex = input.OriginalLatex ?? input.Content,
                Omml = omml,
                Display = input.Display == "display" ? "block" : "inline",
                StorageMode = "ole",
            };

            var adapter = new PowerPointAdapter(_application);
            var result = adapter.InsertFormula(payload, InsertMode.Inline);

            if (result.Success)
            {
                return InsertMathResult.Succeeded(result.FormulaId);
            }

            // Fallback: try image-based insertion
            if (payload.Render?.Png != null || payload.Render?.Svg != null)
            {
                result = adapter.InsertFormula(payload, InsertMode.Inline);
                if (result.Success)
                    return InsertMathResult.Succeeded(result.FormulaId);
            }

            return InsertMathResult.Failed(
                result.Error ?? "Insert failed",
                result.ErrorCode);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PPTMathAdapter] Insert error: {ex.Message}");
            return InsertMathResult.Failed(ex.Message, "INSERT_ERROR");
        }
    }

    /// <summary>
    /// Insert with explicit target (no ActiveSlide dependency).
    /// Used by batch conversion to target a specific slide.
    /// </summary>
    public InsertMathResult Insert(MathInput input, PowerPointMathTarget target)
    {
        try
        {
            var slide = target.Slide as PptInterop.Slide;
            if (slide == null)
                return InsertMathResult.Failed("Invalid slide target", "INVALID_TARGET");

            // Activate the target slide for the insert path, then restore
            var previousSlide = _application.ActiveWindow?.View?.Slide as PptInterop.Slide;
            try
            {
                slide.Select();
                return Insert(input);
            }
            finally
            {
                if (previousSlide != null && previousSlide != slide)
                {
                    try { previousSlide.Select(); } catch { System.Diagnostics.Debug.WriteLine("Skipped COM object"); }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PPTMathAdapter] Targeted insert error: {ex.Message}");
            return InsertMathResult.Failed(ex.Message, "INSERT_ERROR");
        }
    }
}
