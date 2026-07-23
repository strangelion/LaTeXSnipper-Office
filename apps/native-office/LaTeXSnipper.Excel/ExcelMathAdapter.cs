// ExcelMathAdapter.cs — Office Math equation insertion for Excel.
//
// Excel distinguishes between:
// - Excel Calculation Formula (=SUM(A1:A10))
// - Office Math Equation (editable math, inserted as anchored object)
//
// This adapter provides Office Math insertion via OMML.

#nullable enable
using System;
using LaTeXSnipper.NativeOffice.Shared;
using Excel = Microsoft.Office.Interop.Excel;

namespace LaTeXSnipper.Excel.Host;

/// <summary>
/// Provides Office Math equation insertion for Excel.
/// Equations are inserted as anchored OLE objects or native OMML shapes.
/// </summary>
internal sealed class ExcelMathAdapter : IMathInsertionAdapter
{
    private readonly Excel.Application _application;

    public ExcelMathAdapter(Excel.Application application)
    {
        _application = application;
    }

    /// <inheritdoc/>
    public InsertMathResult Insert(MathInput input)
    {
        try
        {
            var sheet = _application.ActiveSheet as Excel.Worksheet;
            if (sheet == null)
                return InsertMathResult.Failed("No active worksheet", "NO_ACTIVE_SHEET");

            var cell = _application.ActiveCell;
            if (cell == null)
                return InsertMathResult.Failed("No active cell", "NO_ACTIVE_CELL");

            string omml = input.Format switch
            {
                "omml" => input.Content,
                "latex" => ConvertLatexToOmml(input.Content),
                _ => throw new NotSupportedException($"Format '{input.Format}' is not supported for Excel math insertion.")
            };

            if (string.IsNullOrEmpty(omml))
                return InsertMathResult.Failed("OMML conversion produced empty result", "OMML_CONVERSION_EMPTY");

            string formulaId = input.FormulaId ?? Guid.NewGuid().ToString("N");

            // Insert as an anchored Office Math object
            // Excel doesn't natively support OMML equations in cells,
            // so we insert as an anchored shape/OLE object with OMML metadata.
            double cellLeft = 0, cellTop = 0;
            try
            {
                cellLeft = Convert.ToDouble(cell.Left);
                cellTop = Convert.ToDouble(cell.Top);
            }
            catch { /* use defaults */ }

            // Use OLE insertion for full round-trip support
            var payload = new FormulaPayload
            {
                SchemaVersion = 3,
                FormulaId = formulaId,
                Latex = input.OriginalLatex ?? input.Content,
                Omml = omml,
                Display = input.Display == "display" ? "block" : "inline",
                StorageMode = "ole",
            };

            var adapter = new ExcelAdapter(_application);
            var result = adapter.InsertFormula(payload, InsertMode.Inline);

            if (result.Success)
            {
                return InsertMathResult.Succeeded(result.FormulaId);
            }

            return InsertMathResult.Failed(
                result.Error ?? "Insert failed",
                result.ErrorCode);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelMathAdapter] Insert error: {ex.Message}");
            return InsertMathResult.Failed(ex.Message, "INSERT_ERROR");
        }
    }

    /// <summary>
    /// Convert LaTeX to OMML using the Desktop's conversion service.
    ///
    /// In production, this calls back to the Desktop via the pipe protocol.
    /// For now, returns a placeholder indicating the Desktop must provide OMML.
    /// </summary>
    private static string ConvertLatexToOmml(string latex)
    {
        // The actual conversion happens on the Desktop side (latexsnipper-core).
        // Excel's adapter receives pre-converted OMML from the Desktop.
        // If we receive LaTeX here, it means the Desktop needs to do conversion first.
        throw new InvalidOperationException(
            "LaTeX→OMML conversion must be performed by the Desktop. " +
            "Send a conversion request before calling InsertMath.");
    }
}
