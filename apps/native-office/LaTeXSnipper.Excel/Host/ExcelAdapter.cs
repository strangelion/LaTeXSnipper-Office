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
                string storageMode = payload.StorageMode ?? "auto";

                if (storageMode == "ole")
                {
                    var oleResult = TryInsertOle(sheet, cell, payload);
                    if (oleResult != null)
                        return new InsertResult { Success = true, FormulaId = payload.FormulaId, ActualStorageMode = "ole" };
                    return new InsertResult { Success = false, Error = "OLE not available. Switch to Auto or Image mode, or enable OLE in LaTeXSnipper settings." };
                }

                if (storageMode == "auto")
                {
                    var oleResult = TryInsertOle(sheet, cell, payload);
                    if (oleResult?.Success == true)
                        return oleResult;
                }

                if (storageMode == "native" || storageMode == "native-omml")
                {
                    return new InsertResult { Success = false, Error = "Excel does not support native OMML insertion" };
                }

                // Image / text fallback
                if (payload.Render?.Png != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Png, ".png");
                    string? fallbackReason = storageMode == "auto" ? "OLE unavailable, fell back to PNG" : null;
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId, ActualStorageMode = "image", FallbackReason = fallbackReason };
                }

                if (payload.Render?.Svg != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Svg, ".svg");
                    string? fallbackReason = storageMode == "auto" ? "OLE unavailable, fell back to SVG" : null;
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId, ActualStorageMode = "image", FallbackReason = fallbackReason };
                }

                if (!string.IsNullOrEmpty(payload.Latex))
                {
                    cell.Value = payload.Latex;
                    string? fallbackReason = storageMode == "auto" ? "No render data, fell back to text" : null;
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId, ActualStorageMode = "text", FallbackReason = fallbackReason };
                }

                return new InsertResult { Success = false, Error = "No render data or LaTeX content" };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Insert error: {ex.Message}");
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        private InsertResult InsertImage(
            Microsoft.Office.Interop.Excel.Worksheet sheet,
            Microsoft.Office.Interop.Excel.Range cell,
            FormulaPayload payload,
            string data,
            string ext)
        {
            var isPng = ext == ".png";
            var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}{ext}");
            if (isPng)
                File.WriteAllBytes(tempPath, Convert.FromBase64String(data));
            else
                File.WriteAllText(tempPath, data);

            float width = payload.Render?.WidthPt > 0 ? payload.Render.WidthPt : 120f;
            float height = payload.Render?.HeightPt > 0 ? payload.Render.HeightPt : 30f;

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
            shape.AlternativeText = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{payload.FormulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";

            // Clean up temp file after successful insertion
            try { if (File.Exists(tempPath)) File.Delete(tempPath); }
            catch { /* best-effort */ }

            return new InsertResult { Success = true, FormulaId = payload.FormulaId };
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

                    // Extract formulaId from shape name: LSNO_{formulaId}
                    var formulaId = ExtractFormulaIdFromShapeName(shape.Name as string);

                    // Layer 1a: OLE object — read full payload via COM automation
                    try
                    {
                        var oleObj = shape.OLEFormat?.Object;
                        if (oleObj != null)
                        {
                            var json = OleFormulaInterop.GetPayloadJson(oleObj);
                            if (!string.IsNullOrEmpty(json))
                            {
                                var payload = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(json,
                                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                                if (payload != null && !string.IsNullOrEmpty(payload.FormulaId))
                                    return payload;
                            }
                        }
                    }
                    catch
                    {
                        // Not an OLE object, continue to layer 1b
                    }

                    // Layer 1b: Old-style LSNO_FORMULA: alt text format
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

                    // Layer 1c: v3 alt text format (LSNO:v3:id=...;storage=...)
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO:v3:"))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = formulaId ?? FormulaIdHelper.NewId(),
                            Latex = "",
                            Display = "inline",
                            StorageMode = "ole"
                        };
                    }

                    // Layer 1d: JSON-based alt text format
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("{"))
                    {
                        try
                        {
                            var jsonPayload = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(altText,
                                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            if (jsonPayload != null && !string.IsNullOrEmpty(jsonPayload.FormulaId))
                                return jsonPayload;
                        }
                        catch { }
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
                            FormulaId = FormulaIdHelper.NewId(),
                            Latex = text,
                            Display = "inline"
                        };
                    }
                }
            }
            catch { }
            return null;
        }

        private static string? ExtractFormulaIdFromShapeName(string? name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            const string prefix = "LSNO_";
            if (name.StartsWith(prefix) && name.Length > prefix.Length)
                return name.Substring(prefix.Length);
            return null;
        }

        /// <summary>
        /// Try to insert formula as an OLE object. Returns null if OLE is unavailable.
        /// </summary>
        private InsertResult? TryInsertOle(
            Microsoft.Office.Interop.Excel.Worksheet sheet,
            Microsoft.Office.Interop.Excel.Range cell,
            FormulaPayload payload)
        {
            try
            {
                // Normalize OLE payload before insertion
                try
                {
                    payload = OleFormulaInterop.NormalizeForOle(payload);
                }
                catch (InvalidOperationException ex)
                {
                    return new InsertResult { Success = false, Error = ex.Message };
                }

                double cellLeft = 0, cellTop = 0;
                try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch { }

                float width = payload.Render?.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                float height = payload.Render?.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                var oleObjects = (Microsoft.Office.Interop.Excel.OLEObjects)sheet.OLEObjects();
                var ole = oleObjects.Add(
                    ClassType: "LaTeXSnipper.Formula.1",
                    Filename: Type.Missing,
                    Link: false,
                    DisplayAsIcon: false,
                    Left: (float)cellLeft,
                    Top: (float)cellTop,
                    Width: width,
                    Height: height
                );

                ole.Name = $"LSNO_{payload.FormulaId}";
                ole.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMoveAndSize;

                // Initialize with formula payload via OLE automation
                if (!OleFormulaInterop.Initialize(ole.Object, payload))
                {
                    ole.Delete();
                    return new InsertResult { Success = false, Error = "OLE initialization failed — rollback" };
                }

                // Verify round-trip
                if (!OleFormulaInterop.VerifyRoundTrip(ole.Object, payload))
                {
                    ole.Delete();
                    return new InsertResult { Success = false, Error = "OLE round-trip verification failed — rollback" };
                }

                System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] OLE object inserted and initialized: name={ole.Name}");
                return new InsertResult { Success = true, FormulaId = payload.FormulaId };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] OLE insert failed (will fall back): {ex.Message}");
                return null;
            }
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

                // NO cell-overlap fallback: never scan all shapes looking for LSNO_.
                // Doing so could delete a formula in an overlapping cell that the user
                // didn't intend to delete. Require explicit shape selection.
                return false;
            }
            catch { }
            return false;
        }

        /// <summary>
        /// Delete a formula by exact FormulaId. Scans all shapes for matching LSNO_ name.
        /// </summary>
        public bool DeleteFormula(string formulaId)
        {
            try
            {
                var excelSheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (excelSheet == null) return false;
                string targetName = $"LSNO_{formulaId}";
                for (int i = excelSheet.Shapes.Count; i >= 1; i--)
                {
                    var shape = excelSheet.Shapes.Item(i);
                    if (string.Equals(shape.Name, targetName, StringComparison.Ordinal))
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
                var excelSheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (excelSheet == null) return false;

                foreach (Microsoft.Office.Interop.Excel.Shape shape in excelSheet.Shapes)
                {
                    if (shape.Name == $"LSNO_{formulaId}")
                    {
                        // OLE path: replace payload in-place via COM automation
                        try
                        {
                            var oleObj = shape.OLEFormat?.Object;
                            if (oleObj != null)
                            {
                                return OleFormulaInterop.ReplacePayloadJson(oleObj, payload);
                            }
                        }
                        catch
                        {
                            // Not an OLE object, fall through to image path
                        }

                        // Guard: without render data, refuse to delete the old shape
                        bool hasRender = payload.Render?.Svg != null || payload.Render?.Png != null;
                        if (!hasRender)
                            return false;

                        // Preserve properties before deleting
                        float oldLeft = 0, oldTop = 0, oldWidth = 120f, oldHeight = 30f;
                        try { oldLeft = (float)Convert.ToDouble(shape.Left); } catch { }
                        try { oldTop = (float)Convert.ToDouble(shape.Top); } catch { }
                        try { oldWidth = (float)Convert.ToDouble(shape.Width); } catch { }
                        try { oldHeight = (float)Convert.ToDouble(shape.Height); } catch { }
                        string oldAltText = "";
                        try { oldAltText = shape.AlternativeText ?? ""; } catch { }
                        int oldZOrder = 0;
                        try { oldZOrder = shape.ZOrderPosition; } catch { }
                        int oldPlacement = -1;
                        try { oldPlacement = (int)shape.Placement; } catch { }

                        shape.Delete();

                        var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                        if (payload.Render?.Png != null)
                        {
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.png");
                            File.WriteAllBytes(tempPath, Convert.FromBase64String(payload.Render.Png));
                        }
                        else
                        {
                            File.WriteAllText(tempPath, payload.Render!.Svg!);
                        }
                        float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                        float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                        var newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                        newShape.Name = $"LSNO_{formulaId}";
                        newShape.AlternativeText = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{formulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";

                        // Restore preserved properties
                        if (oldPlacement >= 0)
                        {
                            try { newShape.Placement = (Microsoft.Office.Interop.Excel.XlPlacement)oldPlacement; } catch { }
                        }
                        if (!string.IsNullOrEmpty(oldAltText) && !oldAltText.StartsWith("LSNO_"))
                        {
                            try { newShape.AlternativeText = oldAltText; } catch { }
                        }
                        // Restore z-order (move behind shapes that were originally behind it)
                        if (oldZOrder > 1)
                        {
                            try { newShape.ZOrder(Microsoft.Office.Core.MsoZOrderCmd.msoSendBackward); } catch { }
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
        public string? ActualStorageMode { get; set; }
        public string? FallbackReason { get; set; }
        public string Error { get; set; } = "";
    }
}
