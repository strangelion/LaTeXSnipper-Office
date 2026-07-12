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
                string storageMode = payload.StorageMode ?? "auto";

                if (storageMode == "ole")
                {
                    var oleResult = TryInsertOle(slide, payload);
                    if (oleResult != null && oleResult.Success)
                        return oleResult;
                    // P1-3: Return the actual error from TryInsertOle, not a generic message.
                    string error = oleResult?.Error ?? "OLE activation failed: unknown error";
                    return new InsertResult { Success = false, ErrorCode = oleResult?.ErrorCode, Error = error };
                }

                string? oleFallbackReason = null;
                if (storageMode == "auto")
                {
                    var oleResult = TryInsertOle(slide, payload);
                    if (oleResult?.Success == true) return oleResult;
                    oleFallbackReason = $"{oleResult?.ErrorCode ?? "OLE_AUTOMATION_UNAVAILABLE"}: {oleResult?.Error ?? "unknown OLE failure"}";
                }

                if (storageMode == "native" || storageMode == "native-omml")
                {
                    return new InsertResult { Success = false, Error = "Native OMML insertion in PowerPoint is not yet implemented. Use OLE or Image mode instead." };
                }

                string? imageExt = null;
                string? imageData = null;
                // PNG-first: Raw MathJax SVG can be accepted by Office but rendered blank.
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
                        System.IO.File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render!.Png!));
                    else
                        File.WriteAllText(tempPath, payload.Render!.Svg!);

                    float width = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                    float height = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                    // Center on slide
                    float slideWidth = pres.PageSetup.SlideWidth;
                    float left = (slideWidth - width) / 2f;
                    float top = 100f;

                    Microsoft.Office.Interop.PowerPoint.Shape shape;
                    try
                    {
                        shape = slide.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue, left, top, width, height);
                    }
                    catch (Exception pngError) when (imageExt == ".png" && payload.Render?.Svg != null)
                    {
                        oleFallbackReason = string.IsNullOrEmpty(oleFallbackReason)
                            ? $"PNG insertion failed: {pngError.Message}"
                            : $"{oleFallbackReason}; PNG insertion failed: {pngError.Message}";
                        tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                        File.WriteAllText(tempPath, payload.Render.Svg);
                        imageData = "SVG";
                        shape = slide.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue, left, top, width, height);
                    }
                    shape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                    shape.Name = $"LSNO_{payload.FormulaId}";
                    var meta = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{payload.FormulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";
                    shape.AlternativeText = meta;
                    shape.Name = $"LSNO_{payload.FormulaId}";
                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] {imageData} shape added: name={shape.Name}, left={left}, top={top}, w={width}, h={height}");
                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] AlternativeText: {meta}");

                    // Clean up temp file after successful insertion
                    try { if (File.Exists(tempPath)) File.Delete(tempPath); }
                    catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "powerpoint", payload.FormulaId, ex); }
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId, ActualStorageMode = "image", FallbackReason = oleFallbackReason };
                }
                return new InsertResult { Success = false, ErrorCode = "OLE_RASTER_FALLBACK_FAILED", Error = "No SVG or PNG render data is available." };
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

                    // Layer 1a: OLE object �?read full payload via COM automation
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
                        OfficeOperationLog.Failure("read-ole-selection", "powerpoint", formulaId, ex);
                        // Not an OLE object, continue
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

                    // Layer 1c: v3 alt text format
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

                    // Layer 1c: JSON-based alt text format
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("{"))
                    {
                        try
                        {
                            var jsonPayload = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(altText,
                                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            if (jsonPayload != null && !string.IsNullOrEmpty(jsonPayload.FormulaId))
                                return ReconcileCopiedFormulaIdentity(shape, jsonPayload, null);
                        }
                        catch (Exception ex) { OfficeOperationLog.Failure("read-ole-payload", "powerpoint", formulaId, ex); }
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
                // Normalize OLE payload before insertion (P0-2)
                try
                {
                    payload = OleFormulaInterop.NormalizeForOle(payload);
                }
                catch (InvalidOperationException ex)
                {
                    return new InsertResult { Success = false, Error = ex.Message };
                }

                // Do not pass Width/Height here.
                // The native OLE object exposes its padded natural extent through GetExtent().

                float slideWidth = _application.ActivePresentation.PageSetup.SlideWidth;
                float top = 100f;

                using (PendingPayloadLease payloadLease = OleFormulaPendingPayloadStore.Save(payload))
                {
                    // P0-5/P2-A: FileName omitted (defaults to null), Link: msoFalse
                    var shape = slide.Shapes.AddOLEObject(
                        Left: (slideWidth - 120f) / 2f,
                        Top: top,
                        ClassName: "LaTeXSnipper.Formula.1",
                        DisplayAsIcon: Microsoft.Office.Core.MsoTriState.msoFalse,
                        Link: Microsoft.Office.Core.MsoTriState.msoFalse
                    );

                    // Center horizontally after the OLE object has its natural extent
                    var naturalWidth = shape.Width;
                    shape.Left = (slideWidth - naturalWidth) / 2f;

                    shape.Name = $"LSNO_{payload.FormulaId}";
                    shape.AlternativeText = $"LSNO:v3:id={payload.FormulaId};storage=ole";

                    OleActivationResult activation = OleFormulaActivation.ActivateAndVerify(
                        () => shape.OLEFormat?.Object,
                        payload,
                        () => shape.Delete());
                    if (!activation.Success)
                    {
                        return new InsertResult { Success = false, ErrorCode = activation.ErrorCode, Error = activation.Message };
                    }

                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] OLE object inserted and initialized: name={shape.Name}");
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId };
                }
            }
            catch (Exception ex)
            {
                // P1-3: Preserve the real error instead of returning null.
                System.Diagnostics.Debug.WriteLine($"[PPTAdapter] OLE insert failed: {ex.Message}");
                return new InsertResult
                {
                    Success = false,
                    Error = $"OLE activation failed: {ex.GetType().Name}: {ex.Message}"
                };
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

        private string EnsureShapeFormulaId(dynamic shape, string? formulaId)
        {
            if (!string.IsNullOrEmpty(formulaId) && FormulaIdHelper.IsCanonical(formulaId))
                return formulaId;
            string newId = FormulaIdHelper.NewId();
            shape.Name = $"LSNO_{newId}";
            OfficeOperationLog.Event("reassign-copied-formula-id", "powerpoint", newId);
            return newId;
        }

        private FormulaPayload ReconcileCopiedFormulaIdentity(dynamic shape, FormulaPayload payload, dynamic? automation)
        {
            string expectedName = $"LSNO_{payload.FormulaId}";
            string actualName = shape.Name as string ?? "";
            int exactMatches = 0;
            var slide = _application.ActiveWindow?.View?.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
            if (slide != null)
            {
                foreach (Microsoft.Office.Core.Shape candidate in slide.Shapes)
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
            OfficeOperationLog.Event("reassign-copied-formula-id", "powerpoint", payload.FormulaId);
            return payload;
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

                // NO fallback scan: never iterate all shapes looking for LSNO_ to delete.
                // Doing so could delete a different formula than the user intended.
                // The user must explicitly select the formula shape first.
                return false;
            }
            catch (Exception ex) { OfficeOperationLog.Failure("delete-selected-formula", "powerpoint", null, ex); }
            return false;
        }

        /// <summary>
        /// Delete a formula by exact FormulaId. Scans all shapes for matching LSNO_ name.
        /// </summary>
        public bool DeleteFormula(string formulaId)
        {
            try
            {
                var slide = _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
                if (slide == null) return false;
                string targetName = $"LSNO_{formulaId}";
                for (int i = slide.Shapes.Count; i >= 1; i--)
                {
                    var shape = slide.Shapes[i];
                    if (string.Equals(shape.Name, targetName, StringComparison.Ordinal))
                    {
                        shape.Delete();
                        return true;
                    }
                }
            }
            catch (Exception ex) { OfficeOperationLog.Failure("delete-formula", "powerpoint", formulaId, ex); }
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
                            OfficeOperationLog.Failure("replace-ole-fallback-image", "powerpoint", formulaId, ex);
                            // Not an OLE object, fall through to image path
                        }

                        // Guard: without render data, refuse to delete the old shape
                        bool hasRender = payload.Render?.Svg != null || payload.Render?.Png != null;
                        if (!hasRender)
                            return false;

                        // Preserve properties before deleting
                        float oldLeft = shape.Left;
                        float oldTop = shape.Top;
                        float oldWidth = shape.Width;
                        float oldHeight = shape.Height;
                        float oldRotation = shape.Rotation;
                        string oldAltText = shape.AlternativeText ?? "";
                        int oldZOrder = 0;
                        try { oldZOrder = shape.ZOrderPosition; } catch (Exception ex) { OfficeOperationLog.Failure("read-z-order", "powerpoint", formulaId, ex); }
                        string imageId = Guid.NewGuid().ToString("N");
                        bool replacingWithPng = !string.IsNullOrWhiteSpace(payload.Render?.Png);
                        string tempPath;
                        if (replacingWithPng)
                        {
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{imageId}.png");
                            System.IO.File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render!.Png!));
                        }
                        else
                        {
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{imageId}.svg");
                            File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                        }
                        float w = payload.Render.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                        float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                        Microsoft.Office.Interop.PowerPoint.Shape newShape;
                        try
                        {
                            newShape = slide.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                        }
                        catch (Exception ex) when (replacingWithPng && !string.IsNullOrWhiteSpace(payload.Render?.Svg))
                        {
                            OfficeOperationLog.Failure("replace-png-fallback-svg", "powerpoint", formulaId, ex);
                            tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{Guid.NewGuid():N}.svg");
                            File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                            newShape = slide.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                        }
                        shape.Delete();
                        newShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                        newShape.Name = $"LSNO_{formulaId}";
                        newShape.AlternativeText = $"LSNO_FORMULA:{payload.Latex}";

                        // Restore preserved properties
                        if (Math.Abs(oldRotation) > 0.01f)
                        {
                            try { newShape.Rotation = oldRotation; } catch (Exception ex) { OfficeOperationLog.Failure("restore-rotation", "powerpoint", formulaId, ex); }
                        }
                        if (!string.IsNullOrEmpty(oldAltText) && !oldAltText.StartsWith("LSNO_"))
                        {
                            try { newShape.AlternativeText = oldAltText; } catch (Exception ex) { OfficeOperationLog.Failure("restore-alt-text", "powerpoint", formulaId, ex); }
                        }
                        // Restore z-order
                        if (oldZOrder > 1)
                        {
                            try { newShape.ZOrder(Microsoft.Office.Core.MsoZOrderCmd.msoSendBackward); } catch (Exception ex) { OfficeOperationLog.Failure("restore-z-order", "powerpoint", formulaId, ex); }
                        }

                        // Clean up temp file
                        try { if (File.Exists(tempPath)) File.Delete(tempPath); }
                        catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "powerpoint", formulaId, ex); }

                        return true;
                    }
                }
            }
            catch (Exception ex) { OfficeOperationLog.Failure("replace-formula", "powerpoint", formulaId, ex); }
            return false;
        }

        // ══════════════════════════════════════════════════════════════�?
        // ICommandHostAdapter implementation
        // ══════════════════════════════════════════════════════════════�?

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
        public string? ActualStorageMode { get; set; }
        public string? FallbackReason { get; set; }
        public string Error { get; set; } = "";
        public string? ErrorCode { get; set; }
    }
}
