using System;
using System.IO;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPointApp = Microsoft.Office.Interop.PowerPoint.Application;

namespace LaTeXSnipper.PowerPoint.Host
{
    internal sealed class PowerPointAdapter
    {
        private readonly PowerPointApp _application;

        public PowerPointAdapter(PowerPointApp application)
        {
            _application = application;
        }

        public string HostType => "powerpoint";

        public string GetCurrentContextId()
        {
            var pres = _application.ActivePresentation;
            if (pres == null) return "powerpoint:unsaved:none";
            return "powerpoint:" + (pres.FullName ?? pres.Name);
        }

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            var pres = _application.ActivePresentation;
            if (pres == null)
                return new InsertResult { Success = false, Error = "No active presentation" };

            var slide = _application.ActiveWindow.View.Slide;
            if (slide == null)
                return new InsertResult { Success = false, Error = "No active slide" };

            try
            {
                if (payload.Render?.Svg != null)
                {
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                    File.WriteAllText(tempPath, payload.Render.Svg);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    var shape = slide.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        50f, 50f, width, height
                    );
                    shape.Name = $"LSNO_{payload.FormulaId}";
                }
                else if (!string.IsNullOrEmpty(payload.Latex))
                {
                    var textShape = slide.Shapes.AddTextbox(
                        Microsoft.Office.Core.MsoTextOrientation.msoTextOrientationHorizontal,
                        50f, 50f, 200f, 40f
                    );
                    textShape.TextFrame.TextRange.Text = payload.Latex;
                }

                return new InsertResult { Success = true, FormulaId = payload.FormulaId };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PPTAdapter] Insert error: {ex.Message}");
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        public FormulaPayload? ReadSelection()
        {
            var sel = _application.ActiveWindow.Selection;
            if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionText)
            {
                var text = sel.TextRange?.Text ?? "";
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
