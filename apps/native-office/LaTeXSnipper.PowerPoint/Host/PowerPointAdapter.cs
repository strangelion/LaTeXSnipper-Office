#nullable enable
using System;
using System.IO;
using LaTeXSnipper.NativeOffice.Shared;
using PowerPointApp = Microsoft.Office.Interop.PowerPoint.Application;

namespace LaTeXSnipper.PowerPoint.Host
{
    internal sealed class PowerPointAdapter : ICommandHostAdapter
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

            var slide = _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
            if (slide == null)
                return new InsertResult { Success = false, Error = "No active slide" };

            try
            {
                // OLE path: try when integration mode is OLE or Auto
                if (payload.StorageMode == "ole" || string.IsNullOrEmpty(payload.StorageMode))
                {
                    var oleResult = TryInsertOle(slide, payload);
                    if (oleResult != null) return oleResult;
                }

                // Prefer PNG over SVG (Office renders PNG more reliably)
                string? imageExt = null;
                string? imageData = null;
                if (payload.Render?.Png != null)
                {
                    imageExt = ".png";
                    imageData = "PNG";
                }
                else if (payload.Render?.Svg != null)
                {
                    imageExt = ".svg";
                    imageData = "SVG";
                }

                if (imageExt != null && imageData != null)
                {
                    var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}{imageExt}");
                    if (imageExt == ".png")
                        File.WriteAllBytes(tempPath, Convert.FromBase64String(payload.Render.Png));
                    else
                        File.WriteAllText(tempPath, payload.Render.Svg);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    // Center on slide
                    float slideWidth = pres.PageSetup.SlideWidth;
                    float left = (slideWidth - width) / 2f;
                    float top = 100f;

                    var shape = slide.Shapes.AddPicture(
                        tempPath,
                        Microsoft.Office.Core.MsoTriState.msoFalse,
                        Microsoft.Office.Core.MsoTriState.msoTrue,
                        left, top, width, height
                    );
                    shape.Name = $"LSNO_{payload.FormulaId}";
                    shape.AlternativeText = $"LSNO_FORMULA:{payload.Latex}";
                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] {imageData} shape added: name={shape.Name}, left={left}, top={top}, w={width}, h={height}");
                }
                else if (!string.IsNullOrEmpty(payload.Latex))
                {
                    var textShape = slide.Shapes.AddTextbox(
                        Microsoft.Office.Core.MsoTextOrientation.msoTextOrientationHorizontal,
                        50f, 100f, 200f, 40f
                    );
                    textShape.TextFrame.TextRange.Text = payload.Latex;
                    textShape.Name = $"LSNO_{payload.FormulaId}";
                    textShape.AlternativeText = $"LSNO_FORMULA:{payload.Latex}";
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

            // Layer 1: check if a shape is selected and has LSNO formula data
            if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionShapes)
            {
                var shapeRange = sel.ShapeRange;
                if (shapeRange != null && shapeRange.Count > 0)
                {
                    var shape = shapeRange[1];

                    // Extract formulaId from shape name: LSNO_{formulaId}
                    var formulaId = ExtractFormulaIdFromShapeName(shape.Name as string);

                    var altText = shape.AlternativeText as string;
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO_FORMULA:"))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = formulaId ?? FormulaIdHelper.NewId(),
                            Latex = altText.Substring("LSNO_FORMULA:".Length),
                            Display = "inline"
                        };
                    }
                }
            }

            // Layer 2: check text selection
            if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionText)
            {
                var text = sel.TextRange?.Text ?? "";
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return new FormulaPayload
                    {
                        FormulaId = FormulaIdHelper.NewId(),
                        Latex = text,
                        Display = "inline"
                    };
                }
            }
            return null;
        }

        /// <summary>
        /// Try to insert formula as an OLE object. Returns null if OLE is unavailable.
        /// </summary>
        private InsertResult? TryInsertOle(Microsoft.Office.Interop.PowerPoint.Slide slide, FormulaPayload payload)
        {
            try
            {
                float width = payload.Render?.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                float height = payload.Render?.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                float slideWidth = _application.ActivePresentation.PageSetup.SlideWidth;
                float left = (slideWidth - width) / 2f;
                float top = 100f;

                var shape = slide.Shapes.AddOLEObject(
                    Left: left,
                    Top: top,
                    Width: width,
                    Height: height,
                    ClassName: "LaTeXSnipper.Formula.1",
                    FileName: Type.Missing,
                    DisplayAsIcon: Microsoft.Office.Core.MsoTriState.msoFalse
                );

                shape.Name = $"LSNO_{payload.FormulaId}";
                shape.AlternativeText = $"LSNO:v3:id={payload.FormulaId};storage=ole";

                // In later phases, call ILatexSnipperFormula.InitializeFromJson() via shape.OLEFormat.Object
                System.Diagnostics.Debug.WriteLine($"[PPTAdapter] OLE object inserted: name={shape.Name}");
                return new InsertResult { Success = true, FormulaId = payload.FormulaId };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PPTAdapter] OLE insert failed (will fall back): {ex.Message}");
                return null;
            }
        }

        private static string? ExtractFormulaIdFromShapeName(string? name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            const string prefix = "LSNO_";
            if (name.StartsWith(prefix) && name.Length > prefix.Length)
                return name.Substring(prefix.Length);
            return null;
        }

        public bool DeleteCurrent()
        {
            try
            {
                var slide = _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
                if (slide == null) return false;

                // Check if a shape is selected in the current selection
                var sel = _application.ActiveWindow.Selection;
                if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionShapes)
                {
                    var shapeRange = sel.ShapeRange;
                    if (shapeRange != null && shapeRange.Count > 0)
                    {
                        var shape = shapeRange[1];
                        if (shape.Name?.StartsWith("LSNO_") == true)
                        {
                            shape.Delete();
                            return true;
                        }
                    }
                }

                // Fallback: iterate all shapes to find LSNO shapes
                for (int i = slide.Shapes.Count; i >= 1; i--)
                {
                    var shape = slide.Shapes[i];
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
                var slide = _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
                if (slide == null) return false;
                foreach (Microsoft.Office.Interop.PowerPoint.Shape shape in slide.Shapes)
                {
                    if (shape.Name == $"LSNO_{formulaId}")
                    {
                        // Preserve geometry before deleting
                        float oldLeft = shape.Left;
                        float oldTop = shape.Top;
                        float oldWidth = shape.Width;
                        float oldHeight = shape.Height;
                        shape.Delete();

                        if (payload.Render?.Svg != null)
                        {
                            var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                            File.WriteAllText(tempPath, payload.Render.Svg);
                            float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                            float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                            var newShape = slide.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
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
                FormulaId = cmd.FormulaId ?? FormulaIdHelper.NewId(),
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
                var sel = _application.ActiveWindow.Selection;
                if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionText)
                {
                    sel.TextRange.Text = cmd.Content;
                }
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
