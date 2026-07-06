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
                if (payload.Render?.Svg != null)
                {
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                    File.WriteAllText(tempPath, payload.Render.Svg);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    double cellLeft = 0, cellTop = 0;
                    try { cellLeft = cell.Left; cellTop = cell.Top; } catch { }

                    var shape = sheet.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        (float)cellLeft, (float)cellTop,
                        width, height
                    );
                    shape.Name = $"LSNO_{payload.FormulaId}";
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
                var selectedShapes = _application.ActiveSheet?.Shapes;
                if (selectedShapes == null) return false;
                // Try to delete shape at selection
                for (int i = selectedShapes.Count; i >= 1; i--)
                {
                    var shape = selectedShapes[i];
                    if (shape.Name?.StartsWith("LSNO_") == true)
                    {
                        shape.Delete();
                        return true;
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
                var sheet = _application.ActiveSheet;
                if (sheet == null) return false;
                // Find existing shape by name
                foreach (Microsoft.Office.Interop.Excel.Shape shape in sheet.Shapes)
                {
                    if (shape.Name == $"LSNO_{formulaId}")
                    {
                        shape.Delete();
                        // Insert new SVG
                        if (payload.Render?.Svg != null)
                        {
                            var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                            File.WriteAllText(tempPath, payload.Render.Svg);
                            float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                            float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;
                            sheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, 50f, 50f, w, h);
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
                FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
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
