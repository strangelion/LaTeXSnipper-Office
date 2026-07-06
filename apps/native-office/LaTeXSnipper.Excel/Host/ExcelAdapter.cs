#nullable enable
using System;
using System.IO;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Excel.Host
{
    internal sealed class ExcelAdapter : ICommandHostAdapter
    {
        private readonly Microsoft.Office.Interop.Excel.Application _application;

        public ExcelAdapter(Microsoft.Office.Interop.Excel.Application application)
        {
            _application = application;
        }

        public string HostType => "excel";

        public string GetCurrentContextId()
        {
            var wb = _application.ActiveWorkbook;
            if (wb == null) return "excel:unsaved:none";
            return "excel:" + (wb.FullName ?? wb.Name);
        }

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
            if (sheet == null)
                return new InsertResult { Success = false, Error = "No active sheet" };

            var cell = _application.ActiveCell;
            if (cell == null)
                return new InsertResult { Success = false, Error = "No active cell" };

            try
            {
                if (payload.Render?.Png != null)
                {
                    System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Inserting PNG ({payload.Render.Png.Length} chars)");
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.png");
                    var pngBytes = Convert.FromBase64String(payload.Render.Png);
                    File.WriteAllBytes(tempPath, pngBytes);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    double cellLeft = 0, cellTop = 0;
                    try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch { }

                    var excelSheet = sheet as Microsoft.Office.Interop.Excel.Worksheet;
                    if (excelSheet == null)
                        return new InsertResult { Success = false, Error = "Cannot cast sheet to Worksheet" };
                    var shape = excelSheet.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        (float)cellLeft, (float)cellTop,
                        width, height
                    );
                    shape.Name = $"LSNO_{payload.FormulaId}";
                    // Store LaTeX in shape's AlternativeText for ReadSelection to retrieve
                    shape.AlternativeText = $"LSNO_FORMULA:{payload.Latex}";
                    System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Shape added: name={shape.Name}, left={cellLeft}, top={cellTop}, w={width}, h={height}");
                }
                else if (payload.Render?.Svg != null)
                {
                    System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Inserting SVG (no PNG available): {payload.Render.Svg.Substring(0, Math.Min(100, payload.Render.Svg.Length))}...");
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                    File.WriteAllText(tempPath, payload.Render.Svg);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    double cellLeft = 0, cellTop = 0;
                    try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch { }

                    var excelSheet = sheet as Microsoft.Office.Interop.Excel.Worksheet;
                    if (excelSheet == null)
                        return new InsertResult { Success = false, Error = "Cannot cast sheet to Worksheet" };
                    var shape = excelSheet.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        (float)cellLeft, (float)cellTop,
                        width, height
                    );
                    shape.Name = $"LSNO_{payload.FormulaId}";
                    shape.AlternativeText = $"LSNO_FORMULA:{payload.Latex}";
                    System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Shape added: name={shape.Name}, left={cellLeft}, top={cellTop}, w={width}, h={height}");
                }
                else if (!string.IsNullOrEmpty(payload.Latex))
                {
                    // Fallback: insert LaTeX as cell text
                    cell.Value = payload.Latex;
                }

                return new InsertResult { Success = true, FormulaId = payload.FormulaId };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Insert error: {ex.Message}");
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        public FormulaPayload? ReadSelection()
        {
            try
            {
                // Layer 1: check if a shape is selected
                var sel = _application.Selection;
                if (sel is Microsoft.Office.Interop.Excel.ShapeRange shapeRange && shapeRange.Count > 0)
                {
                    var shape = shapeRange.Item(1);
                    var altText = shape.AlternativeText as string;
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO_FORMULA:"))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
                            Latex = altText.Substring("LSNO_FORMULA:".Length),
                            Display = "inline"
                        };
                    }
                }

                // Layer 2: read cell text
                var range = _application.Selection as Microsoft.Office.Interop.Excel.Range;
                if (range != null && range.Value != null)
                {
                    var text = range.Text?.ToString() ?? "";
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
                            Latex = text,
                            Display = "inline"
                        };
                    }
                }
            }
            catch { }
            return null;
        }

        public bool DeleteCurrent()
        {
            try
            {
                var excelSheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (excelSheet == null) return false;

                // Check if a shape is currently selected
                var sel = _application.Selection;
                if (sel is Microsoft.Office.Interop.Excel.ShapeRange shapeRange)
                {
                    var shape = shapeRange.Item(1);
                    if (shape.Name?.StartsWith("LSNO_") == true)
                    {
                        shape.Delete();
                        return true;
                    }
                    return false;
                }

                // If cell selected, check if any LSNO shape overlaps the active cell
                var cell = _application.ActiveCell;
                if (cell == null) return false;

                double cellLeft, cellTop, cellWidth, cellHeight;
                try
                {
                    cellLeft = Convert.ToDouble(cell.Left);
                    cellTop = Convert.ToDouble(cell.Top);
                    cellWidth = Convert.ToDouble(cell.Width);
                    cellHeight = Convert.ToDouble(cell.Height);
                }
                catch { return false; }

                double cellRight = cellLeft + cellWidth;
                double cellBottom = cellTop + cellHeight;

                for (int i = excelSheet.Shapes.Count; i >= 1; i--)
                {
                    var shape = excelSheet.Shapes.Item(i);
                    if (shape.Name?.StartsWith("LSNO_") == true)
                    {
                        double sLeft = Convert.ToDouble(shape.Left);
                        double sTop = Convert.ToDouble(shape.Top);
                        double sRight = sLeft + Convert.ToDouble(shape.Width);
                        double sBottom = sTop + Convert.ToDouble(shape.Height);

                        // Check overlap with selected cell
                        if (sLeft < cellRight && sRight > cellLeft &&
                            sTop < cellBottom && sBottom > cellTop)
                        {
                            shape.Delete();
                            return true;
                        }
                    }
                }
            }
            catch { }
            return false;
        }

        public bool ReplaceFormula(string formulaId, FormulaPayload payload)
        {
            try
            {
                var excelSheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (excelSheet == null) return false;
                foreach (Microsoft.Office.Interop.Excel.Shape shape in excelSheet.Shapes)
                {
                    if (shape.Name == $"LSNO_{formulaId}")
                    {
                        // Preserve geometry before deleting
                        float oldLeft = 0, oldTop = 0, oldWidth = 120f, oldHeight = 30f;
                        try { oldLeft = (float)Convert.ToDouble(shape.Left); } catch { }
                        try { oldTop = (float)Convert.ToDouble(shape.Top); } catch { }
                        try { oldWidth = (float)Convert.ToDouble(shape.Width); } catch { }
                        try { oldHeight = (float)Convert.ToDouble(shape.Height); } catch { }

                        shape.Delete();

                        if (payload.Render?.Svg != null)
                        {
                            var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                            File.WriteAllText(tempPath, payload.Render.Svg);
                            float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                            float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                            var newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                            newShape.Name = $"LSNO_{formulaId}";
                        }
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // ICommandHostAdapter implementation
        // ═══════════════════════════════════════════════════════════════

        public CommandResultMessage Execute(CommandMessage cmd)
        {
            switch (cmd)
            {
                case CommandMessage.InsertFormula ic:
                    return ExecuteInsertFormula(ic);

                case CommandMessage.GetSelection:
                    return ExecuteGetSelection();

                case CommandMessage.ReplaceSelection rs:
                    return ExecuteReplaceSelection(rs);

                default:
                    return CommandResultMessage.Failure(
                        cmd.RequestId,
                        $"Unsupported command: {cmd.GetType().Name}");
            }
        }

        private CommandResultMessage ExecuteInsertFormula(CommandMessage.InsertFormula cmd)
        {
            var payload = new FormulaPayload
            {
                FormulaId = cmd.FormulaId ?? Guid.NewGuid().ToString("N").Substring(0, 12),
                Latex = cmd.Latex,
                Display = cmd.Display
            };
            var mode = cmd.Display == "numbered" ? InsertMode.DisplayNumbered : InsertMode.Inline;
            var result = InsertFormula(payload, mode);
            return result.Success
                ? CommandResultMessage.Success(cmd.RequestId, result.FormulaId)
                : CommandResultMessage.Failure(cmd.RequestId, result.Error ?? "Insert failed");
        }

        private CommandResultMessage ExecuteGetSelection()
        {
            var payload = ReadSelection();
            if (payload == null)
                return CommandResultMessage.Failure("", "No selection");
            return CommandResultMessage.Success("", payload.Latex);
        }

        private CommandResultMessage ExecuteReplaceSelection(CommandMessage.ReplaceSelection cmd)
        {
            try
            {
                var cell = _application.ActiveCell;
                if (cell != null)
                    cell.Value = cmd.Content;
                return CommandResultMessage.Success(cmd.RequestId);
            }
            catch (Exception ex)
            {
                return CommandResultMessage.Failure(cmd.RequestId, ex.Message);
            }
        }
    }

    internal sealed class InsertResult
    {
        public bool Success { get; set; }
        public string FormulaId { get; set; } = "";
        public uint? RangeStart { get; set; }
        public uint? RangeEnd { get; set; }
        public string Error { get; set; } = "";
    }
}
