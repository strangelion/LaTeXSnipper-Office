#nullable enable
using System;
using System.IO;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Excel.Host
{
    internal sealed class ExcelAdapter : ICommandHostAdapter
    {
        private readonly Microsoft.Office.Interop.Excel.Application _application;
        private readonly int? _oleServerProcessId;

        public ExcelAdapter(
            Microsoft.Office.Interop.Excel.Application application,
            int? oleServerProcessId = null)
        {
            _application = application;
            _oleServerProcessId = oleServerProcessId;
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
                dynamic? selectedShape = TryGetSelectedShape();
                if (selectedShape != null)
                {
                    var shape = selectedShape;

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

                // Layer 1e: a single managed OLE object is an unambiguous fallback for
                // older Excel builds that expose neither ShapeRange nor DrawingObjects.
                // Never return the first item from a multi-object sheet: that can open
                // the wrong editable formula after a user selects another object.
                try
                {
                    var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                    if (sheet != null)
                    {
                        var oleObjects = sheet.OLEObjects() as Microsoft.Office.Interop.Excel.OLEObjects;
                        if (oleObjects != null && oleObjects.Count == 1)
                        {
                            foreach (Microsoft.Office.Interop.Excel.OLEObject oleObj in oleObjects)
                            {
                                if (oleObj == null) continue;
                                string? name = oleObj.Name as string;
                                dynamic? hostShape = null;
                                try { hostShape = oleObj.ShapeRange.Item(1); }
                                catch (Exception ex) { OfficeOperationLog.Failure("read-ole-shape", "excel", null, ex); }
                                string? extractedId = ExtractFormulaIdFromShapeName(name)
                                    ?? (hostShape == null ? null : ExtractFormulaIdFromShapeMetadata(hostShape));
                                if (string.IsNullOrEmpty(extractedId))
                                    continue;

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

        private dynamic? TryGetSelectedShape()
        {
            object? selection = null;
            try
            {
                selection = _application.Selection;
                if (selection is Microsoft.Office.Interop.Excel.ShapeRange shapeRange && shapeRange.Count > 0)
                    return shapeRange.Item(1);

                try
                {
                    object reflectedRange = selection.GetType().InvokeMember(
                        "ShapeRange",
                        System.Reflection.BindingFlags.GetProperty,
                        null,
                        selection,
                        null);
                    object reflectedShape = reflectedRange.GetType().InvokeMember(
                        "Item",
                        System.Reflection.BindingFlags.GetProperty |
                        System.Reflection.BindingFlags.InvokeMethod,
                        null,
                        reflectedRange,
                        new object[] { 1 });
                    if (reflectedShape != null) return reflectedShape;
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("resolve-selected-shape-range", "excel", null, ex);
                }

                try
                {
                    string? selectedName = Convert.ToString(selection.GetType().InvokeMember(
                        "Name",
                        System.Reflection.BindingFlags.GetProperty,
                        null,
                        selection,
                        null));
                    var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                    if (!string.IsNullOrWhiteSpace(selectedName) && sheet != null)
                        return sheet.Shapes.Item(selectedName);
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("resolve-selected-shape-name", "excel", null, ex);
                }

                // Excel normally exposes a selected embedded OLE object as the
                // DrawingObjects COM interface. Its ShapeRange is only reachable via
                // late binding, so a C# type check alone misses the current selection.
                dynamic selected = selection;
                try
                {
                    dynamic range = selected.ShapeRange;
                    if (range != null && range.Count > 0) return range.Item(1);
                }
                catch { }

                try
                {
                    dynamic item = selected.Item(1);
                    dynamic range = item.ShapeRange;
                    if (range != null && range.Count > 0) return range.Item(1);
                }
                catch { }
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("resolve-selected-shape", "excel", null, ex);
            }
            return null;
        }

        private static FormulaPayload? ReadShapeMetadata(dynamic shape)
        {
            try
            {
                string? alternativeText = shape.AlternativeText as string;
                if (string.IsNullOrWhiteSpace(alternativeText) || !alternativeText.StartsWith("{"))
                    return null;
                return System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(alternativeText,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch
            {
                return null;
            }
        }

        private static string? ExtractFormulaIdFromShapeMetadata(dynamic shape)
        {
            var payload = ReadShapeMetadata(shape);
            return payload != null && FormulaIdHelper.IsCanonical(payload.FormulaId)
                ? payload.FormulaId
                : null;
        }

        private static bool ShapeMatchesFormulaId(dynamic shape, string formulaId)
        {
            string? namedId = null;
            try { namedId = ExtractFormulaIdFromShapeName(shape.Name as string); }
            catch { }
            if (string.Equals(namedId, formulaId, StringComparison.Ordinal)) return true;
            return string.Equals(ExtractFormulaIdFromShapeMetadata(shape), formulaId, StringComparison.Ordinal);
        }

        private static bool IsManagedShape(dynamic shape)
        {
            string? name = null;
            try { name = shape.Name as string; } catch { }
            return ExtractFormulaIdFromShapeName(name) != null
                || ExtractFormulaIdFromShapeMetadata(shape) != null;
        }

        private static void WriteShapeIdentity(dynamic shape, FormulaPayload payload)
        {
            // Excel can reject OLEObject/Shape.Name changes even after insertion has
            // completed. AlternativeText is therefore the canonical, portable identity
            // channel; the LSNO_* name remains a best-effort compatibility index.
            shape.AlternativeText = OleFormulaInterop.CreateHostMetadataJson(payload);
            try { shape.Name = $"LSNO_{payload.FormulaId}"; }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("write-shape-name-fallback-metadata", "excel", payload.FormulaId, ex);
            }
        }

        private string EnsureShapeFormulaId(dynamic shape, string? formulaId)
        {
            if (!string.IsNullOrEmpty(formulaId) && FormulaIdHelper.IsCanonical(formulaId))
                return formulaId;
            string newId = FormulaIdHelper.NewId();
            try { shape.Name = $"LSNO_{newId}"; }
            catch (Exception ex) { OfficeOperationLog.Failure("write-shape-name", "excel", newId, ex); }
            OfficeOperationLog.Event("reassign-copied-formula-id", "excel", newId);
            return newId;
        }

        private FormulaPayload ReconcileCopiedFormulaIdentity(dynamic shape, FormulaPayload payload, dynamic? automation)
        {
            string actualId = ExtractFormulaIdFromShapeName(shape.Name as string)
                ?? ExtractFormulaIdFromShapeMetadata(shape)
                ?? "";
            int exactMatches = 0;
            var sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
            if (sheet != null)
            {
                foreach (Microsoft.Office.Interop.Excel.Shape candidate in sheet.Shapes)
                    if (ShapeMatchesFormulaId(candidate, payload.FormulaId)) exactMatches++;
            }
            if (string.Equals(actualId, payload.FormulaId, StringComparison.Ordinal) && exactMatches <= 1)
                return payload;

            string previousId = payload.FormulaId;
            payload.FormulaId = FormulaIdHelper.NewId();
            payload.Revision = 0;
            if (automation != null && !OleFormulaInterop.ReplacePayloadJson(automation, payload))
            {
                payload.FormulaId = previousId;
                throw new InvalidOperationException("Failed to persist a reassigned formulaId to the copied OLE object.");
            }
            WriteShapeIdentity(shape, payload);
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
            string stage = "normalize";
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

                stage = "cell-position";
                double cellLeft = 0, cellTop = 0;
                try { cellLeft = Convert.ToDouble(cell.Left); cellTop = Convert.ToDouble(cell.Top); } catch (Exception ex) { OfficeOperationLog.Failure("read-cell-position", "excel", payload.FormulaId, ex); }

                // Do not pass Width/Height here.
                // The native OLE object exposes its padded natural extent through GetExtent().

                using (PendingPayloadLease payloadLease = _oleServerProcessId.HasValue
                    ? OleFormulaPendingPayloadStore.SaveForProcess(
                        payload,
                        _oleServerProcessId.Value)
                    : OleFormulaPendingPayloadStore.Save(payload))
                {
                    stage = "add-ole-object";
                    var oleObjects = (Microsoft.Office.Interop.Excel.OLEObjects)sheet.OLEObjects();
                    var ole = oleObjects.Add(
                        ClassType: "LaTeXSnipper.Formula.1",
                        Filename: Type.Missing,
                        Link: false,
                        DisplayAsIcon: false,
                        Left: (float)cellLeft,
                        Top: (float)cellTop
                    );

                    // Recent Excel builds expose OLEObject.Name as non-writable for
                    // freshly embedded objects, and ShapeRange.Name can throw for a
                    // newly activated OLE range. Resolve the backing worksheet Shape
                    // immediately after Add; that is the identity selection readback
                    // and document lifecycle operations use.
                    stage = "resolve-host-shape";
                    Microsoft.Office.Interop.Excel.Shape hostShape =
                        ole.ShapeRange.Item(1);
                    ole.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMove;

                    stage = "activate-and-verify";
                    using OleActivationResult activation = OleFormulaActivation.ActivateAndVerify(
                        () => ole.Object,
                        payload,
                        () => ole.Delete(),
                        OleRcwOwnership.OwnedTemporaryRcw);
                    if (!activation.Success)
                    {
                        return new InsertResult { Success = false, ErrorCode = activation.ErrorCode, Error = activation.Message };
                    }

                    // Query the OLE object's natural extent and compute display size with scale.
                    stage = "read-natural-extent";
                    if (activation.AutomationObject == null ||
                        !OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints naturalExtent))
                    {
                        ole.Delete();
                        return new InsertResult { Success = false, ErrorCode = "OLE_EXTENT_UNAVAILABLE", Error = "The OLE object did not expose a valid natural extent." };
                    }

                    OleExtentPoints targetExtent = OleFormulaInterop.GetInitialDisplayExtent(payload, naturalExtent, OleHostKind.Excel);

                    // Deselect the OLE object so the host can finalize it
                    stage = "finalize-selection";
                    cell.Select();

                    // CompleteInsertion BEFORE setting Width/Height so SetExtent is no longer ignored
                    stage = "complete-insertion";
                    if (!OleFormulaInterop.CompleteInsertion(activation.AutomationObject))
                    {
                        ole.Delete();
                        return new InsertResult { Success = false, ErrorCode = "OLE_COMPLETE_INSERTION_FAILED", Error = "OLE object did not complete insertion." };
                    }
                    if (!OleFormulaInterop.TrySetDisplayExtent(activation.AutomationObject, targetExtent) ||
                        !OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints synchronizedExcelExtent) ||
                        !OleFormulaInterop.DisplayExtentMatches(targetExtent, synchronizedExcelExtent))
                    {
                        targetExtent = new OleExtentPoints(
                            targetExtent.NaturalWidthPt,
                            targetExtent.NaturalHeightPt,
                            targetExtent.NaturalWidthPt,
                            targetExtent.NaturalHeightPt);
                        OleFormulaInterop.TrySetDisplayExtent(activation.AutomationObject, targetExtent);
                        System.Diagnostics.Debug.WriteLine("[ExcelAdapter] OLE extent synchronization failed; using natural size.");
                    }

                    // Now set final dimensions — SetExtent accepts them after CompleteInsertion
                    stage = "apply-host-extent";
                    try { ole.ShapeRange.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse; }
                    catch (Exception ex) { OfficeOperationLog.Failure("unlock-ole-aspect-ratio", "excel", payload.FormulaId, ex); }
                    ole.Width = targetExtent.DisplayWidthPt;
                    ole.Height = targetExtent.DisplayHeightPt;
                    try { ole.ShapeRange.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue; }
                    catch (Exception ex) { OfficeOperationLog.Failure("lock-ole-aspect-ratio", "excel", payload.FormulaId, ex); }

                    ole.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMove;
                    stage = "write-host-identity";
                    WriteShapeIdentity(hostShape, payload);

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
                    Error = $"OLE activation failed at {stage}: {ex.GetType().Name}: {ex.Message}"
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
                    if (IsManagedShape(shape))
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
                for (int i = excelSheet.Shapes.Count; i >= 1; i--)
                {
                    var shape = excelSheet.Shapes.Item(i);
                    if (ShapeMatchesFormulaId(shape, formulaId))
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
                    if (ShapeMatchesFormulaId(shape, formulaId))
                    {
                        // OLE path: replace payload in-place via COM automation
                        try
                        {
                            var oleObj = shape.OLEFormat?.Object;
                            if (oleObj != null)
                            {
                                bool replaced = OleFormulaInterop.ReplacePayloadJson(oleObj, payload);
                                if (replaced)
                                {
                                    // Update shape dimensions to match new extent
                                    if (OleFormulaInterop.TryGetExtentPoints(oleObj, out var newExtent))
                                    {
                                        shape.Width = newExtent.DisplayWidthPt;
                                        shape.Height = newExtent.DisplayHeightPt;
                                    }
                                }
                                return replaced;
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

                        string imageToken = Guid.NewGuid().ToString("N");
                        bool replacingWithPng = !string.IsNullOrWhiteSpace(payload.Render?.Png);
                        string? tempPath = null;

                        try
                        {
                            if (replacingWithPng)
                            {
                                tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{imageToken}.png");
                                File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render!.Png!));
                            }
                            else if (!string.IsNullOrWhiteSpace(payload.Render?.Svg))
                            {
                                tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{imageToken}.svg");
                                File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                            }
                            else
                            {
                                return false;
                            }

                            float w = payload.Render!.WidthPt > 0 ? payload.Render.WidthPt : oldWidth;
                            float h = payload.Render.HeightPt > 0 ? payload.Render.HeightPt : oldHeight;
                            Microsoft.Office.Interop.Excel.Shape newShape;
                            try
                            {
                                newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                    Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                            }
                            catch (Exception ex) when (replacingWithPng && !string.IsNullOrWhiteSpace(payload.Render?.Svg))
                            {
                                OfficeOperationLog.Failure("replace-png-fallback-svg", "excel", formulaId, ex);
                                try { if (tempPath != null && File.Exists(tempPath)) File.Delete(tempPath); }
                                catch (Exception cleanupError) { OfficeOperationLog.Failure("delete-temp", "excel", formulaId, cleanupError); }
                                tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{Guid.NewGuid():N}.svg");
                                File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                                newShape = excelSheet.Shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                                    Microsoft.Office.Core.MsoTriState.msoTrue, oldLeft, oldTop, w, h);
                            }
                            shape.Delete();
                            newShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                            newShape.Name = $"LSNO_{formulaId}";
                            newShape.AlternativeText = $"{{\"kind\":\"latexsnipper.formula\",\"schemaVersion\":3,\"formulaId\":\"{formulaId}\",\"latex\":{System.Text.Json.JsonSerializer.Serialize(payload.Latex)},\"storageMode\":\"image\"}}";

                            if (oldPlacement >= 0)
                            {
                                try { newShape.Placement = (Microsoft.Office.Interop.Excel.XlPlacement)oldPlacement; } catch (Exception ex) { OfficeOperationLog.Failure("restore-placement", "excel", formulaId, ex); }
                            }
                            if (!string.IsNullOrEmpty(oldAltText) && !oldAltText.StartsWith("LSNO_"))
                            {
                                try { newShape.AlternativeText = oldAltText; } catch (Exception ex) { OfficeOperationLog.Failure("restore-alt-text", "excel", formulaId, ex); }
                            }
                            if (oldZOrder > 1)
                            {
                                try { newShape.ZOrder(Microsoft.Office.Core.MsoZOrderCmd.msoSendBackward); } catch (Exception ex) { OfficeOperationLog.Failure("restore-z-order", "excel", formulaId, ex); }
                            }
                            return true;
                        }
                        finally
                        {
                            try { if (tempPath != null && File.Exists(tempPath)) File.Delete(tempPath); }
                            catch (Exception cleanupError) { OfficeOperationLog.Failure("delete-temp", "excel", formulaId, cleanupError); }
                        }
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
}
