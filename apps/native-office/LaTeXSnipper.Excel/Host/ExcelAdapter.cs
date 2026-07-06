using System;
using System.IO;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Excel.Host
{
    internal sealed class ExcelAdapter
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

            var cell = _application.Selection as Microsoft.Office.Interop.Excel.Range;
            if (cell == null)
                return new InsertResult { Success = false, Error = "No selection" };

            try
            {
                if (payload.Render?.Svg != null)
                {
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                    File.WriteAllText(tempPath, payload.Render.Svg);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    var shape = sheet.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        (float)cell.Left, (float)cell.Top,
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
