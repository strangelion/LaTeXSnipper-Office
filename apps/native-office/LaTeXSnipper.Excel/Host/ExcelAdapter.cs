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
                    if (oleResult != null && oleResult.Success)
                        return oleResult;
                    // P1-3: Return the actual error from TryInsertOle, not a generic message.
                    // Auto mode callers can decide to fall back; explicit OLE mode surfaces the error.
                    string error = oleResult?.Error ?? "OLE activation failed: unknown error";
                    return new InsertResult { Success = false, ErrorCode = oleResult?.ErrorCode, Error = error };
                }

                string? oleFallbackReason = null;
                if (storageMode == "auto")
                {
                    var oleResult = TryInsertOle(sheet, cell, payload);
                    if (oleResult?.Success == true)
                        return oleResult;
                    oleFallbackReason = $"{oleResult?.ErrorCode ?? "OLE_AUTOMATION_UNAVAILABLE"}: {oleResult?.Error ?? "unknown OLE failure"}";
                }

                if (storageMode == "native" || storageMode == "native-omml")
                {
                    return new InsertResult { Success = false, Error = "Native OMML insertion in Excel is not yet implemented. Use OLE or Image mode instead." };
                }

                // Image / text fallback - PNG-first (Raw MathJax SVG renders blank in Office)
                if (payload.Render?.Png != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Png, ".png");
                    imageResult.ActualStorageMode = "image";
                    imageResult.FallbackReason = oleFallbackReason ?? "OLE unavailable; used high-DPI PNG";
                    return imageResult;
                }

                if (payload.Render?.Svg != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Svg, ".svg");
                    imageResult.ActualStorageMode = "image";
                    imageResult.FallbackReason = oleFallbackReason ?? "PNG unavailable; used SVG";
                    return imageResult;
                }

                return new InsertResult { Success = false, ErrorCode = "OLE_RASTER_FALLBACK_FAILED", Error = "No SVG or PNG render data is available." };
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
            try
            {
                if (isPng)
                    System.IO.File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(data));
                else
                    File.WriteAllText(tempPath, data);

                float width = payload.Render?.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                float height = payload.Render?.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                double cellLeft = 0, cellTop = 0;
                try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch (Exception ex) { OfficeOperationLog.Failure("read-cell-position", "excel", payload.FormulaId, ex); }

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
                shape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                shape.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMove;
                shape.AlternativeText = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{payload.FormulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";

                return new InsertResult { Success = true, FormulaId = payload.FormulaId };
            }
            finally
            {
                try { if (File.Exists(tempPath)) File.Delete(tempPath); }
                catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "excel", payload.FormulaId, ex); }
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

                    // Extract formulaId from shape name: LSNO_{formulaId}
                    var formulaId = ExtractFormulaIdFromShapeName(shape.Name as string);

                    // Layer 1a: OLE object - read full payload via COM automation
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
                                    return ReconcileCopiedFormulaIdentity(shape, payload, oleObj);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure("read-ole-selection", "excel", formulaId, ex);
                        // Not an OLE object, continue to layer 1b
                    }

                    // Layer 1b: Old-style LSNO_FORMULA: alt text format
                    var altText = shape.AlternativeText as string;
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO_FORMULA:"))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = EnsureShapeFormulaId(shape, formulaId),
                            Latex = altText.Substring("LSNO_FORMULA:".Length),
                            Display = "inline"
                        };
                    }

                    // Layer 1c: v3 alt text format (LSNO:v3:id=...;storage=...)
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO:v3:"))
                    {
                        return new FormulaPayload
                        {
                            FormulaId = EnsureShapeFormulaId(shape, formulaId),
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
                                return ReconcileCopiedFormulaIdentity(shape, jsonPayload, null);
                        }
                        catch (Exception ex) { OfficeOperationLog.Failure("read-ole-payload", "excel", formulaId, ex); }
                    }
                }

                // P1-4: Layer 1e: ShapeRange may not always detect OLE objects.
                // Try ActiveSheet.OLEObjects() to find any matching object by name or alt text.
                try
                {
                    var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                    if (sheet != null)
                    {
                        var oleObjects = sheet.OLEObjects() as Microsoft.Office.Interop.Excel.OLEObjects;
                        if (oleObjects != null)
                        {
                            foreach (Microsoft.Office.Interop.Excel.OLEObject oleObj in oleObjects)
                            {
                                if (oleObj == null) continue;
                                string? name = oleObj.Name as string;
                                if (string.IsNullOrEmpty(name) || !name.StartsWith("LSNO_"))
                                    continue;

                                string? extractedId = ExtractFormulaIdFromShapeName(name);

                                // Try reading payload via COM automation
                                try
                                {
                                    var automation = oleObj.Object;
                                    if (automation != null)
                                    {
                                        var json = OleFormulaInterop.GetPayloadJson(automation);
                                        if (!string.IsNullOrEmpty(json))
                                        {
                                            var payload = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(json,
                                                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                                            if (payload != null && !string.IsNullOrEmpty(payload.FormulaId))
                                                return payload;
                                        }
                                    }
                                }
                                catch (Exception ex) { OfficeOperationLog.Failure("read-shape-metadata", "excel", extractedId, ex); }

                                // Fallback: alt text with formula ID
                                if (!string.IsNullOrEmpty(extractedId))
                                {
                                    return new FormulaPayload
                                    {
                                        FormulaId = extractedId,
                                        Latex = "",
                                        Display = "inline",
                                        StorageMode = "ole"
                                    };
                                }
                            }
                        }
                    }
                }
                catch (Exception ex) { OfficeOperationLog.Failure("read-selected-shape", "excel", null, ex); }

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
            catch (Exception ex) { OfficeOperationLog.Failure("read-selection", "excel", null, ex); }
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

        private string EnsureShapeFormulaId(dynamic shape, string? formulaId)
        {
            if (!string.IsNullOrEmpty(formulaId) && FormulaIdHelper.IsCanonical(formulaId))
                return formulaId;
            string newId = FormulaIdHelper.NewId();
            shape.Name = $"LSNO_{newId}";
            OfficeOperationLog.Event("reassign-copied-formula-id", "excel", newId);
            return newId;
        }

        private FormulaPayload ReconcileCopiedFormulaIdentity(dynamic shape, FormulaPayload payload, dynamic? automation)
        {
            string expectedName = $"LSNO_{payload.FormulaId}";
            string actualName = shape.Name as string ?? "";
            int exactMatches = 0;
            var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
            if (sheet != null)
            {
                foreach (Microsoft.Office.Core.Shape candidate in sheet.Shapes)
                    if (string.Equals(candidate.Name, expectedName, StringComparison.Ordinal)) exactMatches++;
            }
            if (string.Equals(actualName, expectedName, StringComparison.Ordinal) && exactMatches <= 1)
                return payload;

            string previousId = payload.FormulaId;
            payload.FormulaId = FormulaIdHelper.NewId();
            payload.Revision = 0;
            if (automation != null && !OleFormulaInterop.ReplacePayloadJson(automation, payload))
            {
                payload.FormulaId = previousId;
                throw new InvalidOperationException("Failed to persist a reassigned formulaId to the copied OLE object.");
            }
            shape.Name = $"LSNO_{payload.FormulaId}";
            shape.AlternativeText = System.Text.Json.JsonSerializer.Serialize(payload);
            OfficeOperationLog.Event("reassign-copied-formula-id", "excel", payload.FormulaId);
            return payload;
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
                try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch (Exception ex) { OfficeOperationLog.Failure("read-cell-position", "excel", payload.FormulaId, ex); }

                // Do not pass Width/Height here.
                // The native OLE object exposes its padded natural extent through GetExtent().

                using (PendingPayloadLease payloadLease = OleFormulaPendingPayloadStore.Save(payload))
                {
                    var oleObjects = (Microsoft.Office.Interop.Excel.OLEObjects)sheet.OLEObjects();
                    var ole = oleObjects.Add(
                        ClassType: "LaTeXSnipper.Formula.1",
                        Filename: Type.Missing,
                        Link: false,
                        DisplayAsIcon: false,
                        Left: (float)cellLeft,
                        Top: (float)cellTop
                    );

                    ole.Name = $"LSNO_{payload.FormulaId}";
                    ole.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMoveAndSize;

                    OleActivationResult activation = OleFormulaActivation.ActivateAndVerify(
                        () => ole.Object,
                        payload,
                        () => ole.Delete());
                    if (!activation.Success)
                    {
                        return new InsertResult { Success = false, ErrorCode = activation.ErrorCode, Error = activation.Message };
                    }

                    System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] OLE object inserted and initialized: name={ole.Name}");
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId };
                }
            }
            catch (Exception ex)
            {
                // P1-3: Preserve the real error instead of returning null.
                // The caller can now display the specific COM/DLL/validation error.
                System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] OLE insert failed: {ex.Message}");
                return new InsertResult
                {
                    Success = false,
                    Error = $"OLE activation failed: {ex.GetType().Name}: {ex.Message}"
                };
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
            catch (Exception ex) { OfficeOperationLog.Failure("delete-selected-formula", "excel", null, ex); }
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
            catch (Exception ex) { OfficeOperationLog.Failure("delete-formula", "excel", formulaId, ex); }
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
                        catch (Exception ex)
                        {
                            OfficeOperationLog.Failure("replace-ole-fallback-image", "excel", formulaId, ex);
                            // Not an OLE object, fall through to image path
                        }

                        // Guard: without render data, refuse to delete the old shape
                        bool hasRender = payload.Render?.Svg != null || payload.Render?.Png != null;
                        if (!hasRender)
                            return false;

                        // Preserve properties before deleting
                        float oldLeft = 0, oldTop = 0, oldWidth = 120f, oldHeight = 30f;
                        try { oldLeft = (float)Convert.ToDouble(shape.Left); } catch (Exception ex) { OfficeOperationLog.Failure("read-shape-left", "excel", formulaId, ex); }
                        try { oldTop = (float)Convert.ToDouble(shape.Top); } catch (Exception ex) { OfficeOperationLog.Failure("read-shape-top", "excel", formulaId, ex); }
                        try { oldWidth = (float)Convert.ToDouble(shape.Width); } catch (Exception ex) { OfficeOperationLog.Failure("read-shape-width", "excel", formulaId, ex); }
                        try { oldHeight = (float)Convert.ToDouble(shape.Height); } catch (Exception ex) { OfficeOperationLog.Failure("read-shape-height", "excel", formulaId, ex); }
                        string oldAltText = "";
                        try { oldAltText = shape.AlternativeText ?? ""; } catch (Exception ex) { OfficeOperationLog.Failure("read-alt-text", "excel", formulaId, ex); }
                        int oldZOrder = 0;
                        try { oldZOrder = shape.ZOrderPosition; } catch (Exception ex) { OfficeOperationLog.Failure("read-z-order", "excel", formulaId, ex); }
                        int oldPlacement = -1;
                        try { oldPlacement = (int)shape.Placement; } catch (Exception ex) { OfficeOperationLog.Failure("read-placement", "excel", formulaId, ex); }

                        var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                        bool replacingWithSvg = payload.Render?.Svg != null;
                        if (replacingWithSvg)
                        {
                            File.WriteAllText(tempPath, payload.Render!.Svg!);
                        }
                        else
                        {
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.png");
                            WritePngPayload(tempPath, payload.Render!.Png!);
                        }
                        float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                        float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                        Microsoft.Office.Interop.Excel.Shape newShape;
                        try
                        {
                            newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                        }
                        catch (Exception ex) when (replacingWithSvg && payload.Render?.Png != null)
                        {
                            OfficeOperationLog.Failure("replace-svg-fallback-png", "excel", formulaId, ex);
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.png");
                            WritePngPayload(tempPath, payload.Render.Png);
                            newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                        }
                        shape.Delete();
                        newShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                        newShape.Name = $"LSNO_{formulaId}";
                        newShape.AlternativeText = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{formulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";

                        // Restore preserved properties
                        if (oldPlacement >= 0)
                        {
                            try { newShape.Placement = (Microsoft.Office.Interop.Excel.XlPlacement)oldPlacement; } catch (Exception ex) { OfficeOperationLog.Failure("restore-placement", "excel", formulaId, ex); }
                        }
                        if (!string.IsNullOrEmpty(oldAltText) && !oldAltText.StartsWith("LSNO_"))
                        {
                            try { newShape.AlternativeText = oldAltText; } catch (Exception ex) { OfficeOperationLog.Failure("restore-alt-text", "excel", formulaId, ex); }
                        }
                        // Restore z-order (move behind shapes that were originally behind it)
                        if (oldZOrder > 1)
                        {
                            try { newShape.ZOrder(Microsoft.Office.Core.MsoZOrderCmd.msoSendBackward); } catch (Exception ex) { OfficeOperationLog.Failure("restore-z-order", "excel", formulaId, ex); }
                        }
                        try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "excel", formulaId, ex); }
                        return true;
                    }
                }
            }
            catch (Exception ex) { OfficeOperationLog.Failure("replace-formula", "excel", formulaId, ex); }
            return false;
        }

        // ====================================================================
        // ICommandHostAdapter implementation
        // ====================================================================

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
        public string? ErrorCode { get; set; }
    }

    private static void WritePngPayload(string path, string encodedPng)
    {
        if (string.IsNullOrWhiteSpace(encodedPng))
            throw new InvalidOperationException("PNG render payload is empty.");

        byte[] bytes = StrictBase64.Decode(encodedPng, allowDataUrl: true, expectedMediaType: "image/png");

        if (bytes.Length < 8 ||
            bytes[0] != 0x89 || bytes[1] != 0x50 || bytes[2] != 0x4E || bytes[3] != 0x47 ||
            bytes[4] != 0x0D || bytes[5] != 0x0A || bytes[6] != 0x1A || bytes[7] != 0x0A)
        {
            throw new FormatException("Decoded render payload is not a PNG file.");
        }

        File.WriteAllBytes(path, bytes);
    }
}
