#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

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

            Microsoft.Office.Interop.Excel.Workbook? workbook = null;
            try
            {
                workbook = (Microsoft.Office.Interop.Excel.Workbook)sheet.Parent;
                string storageMode = payload.StorageMode ?? "auto";

                if (storageMode == "ole")
                {
                    var oleResult = TryInsertOle(sheet, cell, payload, workbook);
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
                    var oleResult = TryInsertOle(sheet, cell, payload, workbook);
                    if (oleResult?.Success == true)
                        return oleResult;
                    if (HostManifestInsertion.IsFailure(oleResult?.ErrorCode)) return oleResult!;
                    oleFallbackReason = $"{oleResult?.ErrorCode ?? "OLE_AUTOMATION_UNAVAILABLE"}: {oleResult?.Error ?? "unknown OLE failure"}";
                }

                if (storageMode == "native" || storageMode == "native-omml")
                {
                    return new InsertResult { Success = false, Error = "Native OMML insertion in Excel is not yet implemented. Use OLE or Image mode instead." };
                }

                // Image / text fallback - PNG-first (Raw MathJax SVG renders blank in Office)
                if (payload.Render?.Png != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Png, ".png", workbook);
                    imageResult.ActualStorageMode = "image";
                    imageResult.FallbackReason = oleFallbackReason ?? "OLE unavailable; used high-DPI PNG";
                    return imageResult;
                }

                if (payload.Render?.Svg != null)
                {
                    var imageResult = InsertImage(sheet, cell, payload, payload.Render.Svg, ".svg", workbook);
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
            finally { if (workbook != null) Marshal.ReleaseComObject(workbook); }
        }

        private InsertResult InsertImage(
            Microsoft.Office.Interop.Excel.Worksheet sheet,
            Microsoft.Office.Interop.Excel.Range cell,
            FormulaPayload payload,
            string data,
            string ext,
            Microsoft.Office.Interop.Excel.Workbook workbook)
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
                shape.AlternativeText = OleFormulaInterop.CreateHostMetadataJson(payload, "image");

                return CommitManifest(workbook, payload, "image", () => shape.Delete());
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
                    catch (HostIdentityReconciliationException) { throw; }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure("read-ole-selection", "excel", formulaId, ex);
                        // Not an OLE object, continue to layer 1b
                    }

                    // Layer 1b: Old-style LSNO_FORMULA: alt text format
                    var altText = shape.AlternativeText as string;
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO_FORMULA:"))
                    {
                        return ReconcileCopiedFormulaIdentity(shape, new FormulaPayload
                        {
                            FormulaId = formulaId ?? "",
                            Latex = altText.Substring("LSNO_FORMULA:".Length),
                            Display = "inline", StorageMode = HostPictureSnapshot.IsPicture(shape) ? "image" : "ole"
                        }, null);
                    }

                    // Layer 1c: v3 alt text format (LSNO:v3:id=...;storage=...)
                    if (!string.IsNullOrEmpty(altText) && altText.StartsWith("LSNO:v3:"))
                    {
                        Microsoft.Office.Interop.Excel.Worksheet? owner = null;
                        Microsoft.Office.Interop.Excel.Workbook? book = null; Microsoft.Office.Core.CustomXMLParts? parts = null;
                        try
                        {
                            owner = HostIdentityReconciliation.FindOwner<Microsoft.Office.Interop.Excel.Worksheet>(shape);
                            book = (Microsoft.Office.Interop.Excel.Workbook)owner.Parent; parts = book.CustomXMLParts;
                            return ReconcileCopiedFormulaIdentity(shape, HostIdentityReconciliation.ReadLegacyReference(parts, altText, formulaId), null);
                        }
                        catch (HostIdentityReconciliationException) { throw; }
                        catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_SOURCE_UNAVAILABLE", error); }
                        finally
                        {
                            if (parts != null) Marshal.ReleaseComObject(parts); if (book != null) Marshal.ReleaseComObject(book);
                            if (owner != null) Marshal.ReleaseComObject(owner);
                        }
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
                        catch (HostIdentityReconciliationException) { throw; }
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
                                                return hostShape == null ? throw new HostIdentityReconciliationException("HOST_IDENTITY_TARGET_UNAVAILABLE",
                                                    new InvalidOperationException("OLE source has no captured host shape.")) :
                                                    ReconcileCopiedFormulaIdentity(hostShape, payload, automation);
                                        }
                                    }
                                }
                                catch (HostIdentityReconciliationException) { throw; }
                                catch (Exception ex) { OfficeOperationLog.Failure("read-shape-metadata", "excel", extractedId, ex); }

                                // Fallback: alt text with formula ID
                                if (!string.IsNullOrEmpty(extractedId))
                                {
                                    throw new HostIdentityReconciliationException("HOST_IDENTITY_SOURCE_UNAVAILABLE",
                                        new InvalidOperationException("OLE identity exists but its source could not be read."));
                                }
                            }
                        }
                    }
                }
                catch (HostIdentityReconciliationException) { throw; }
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
            catch (HostIdentityReconciliationException) { throw; }
            catch (Exception ex) { OfficeOperationLog.Failure("read-selection", "excel", null, ex); }
            return null;
        }

        public TablePayload? ReadTableSelection()
        {
            if (_application.Selection is not Microsoft.Office.Interop.Excel.Range range)
                return null;

            int rows = range.Rows.Count;
            int columns = range.Columns.Count;
            return SpreadsheetTablePayload.FromValues(
                range.Value2,
                rows,
                columns,
                FormulaIdHelper.NewId());
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
                if (selection is Microsoft.Office.Interop.Excel.ShapeRange shapeRange)
                {
                    if (shapeRange.Count != 1) throw new HostIdentityReconciliationException("HOST_IDENTITY_SELECTION_AMBIGUOUS", new InvalidOperationException("Select one formula object."));
                    return shapeRange.Item(1);
                }

                try
                {
                    object reflectedRange = selection.GetType().InvokeMember(
                        "ShapeRange",
                        System.Reflection.BindingFlags.GetProperty,
                        null,
                        selection,
                        null);
                    if ((int)((dynamic)reflectedRange).Count != 1)
                        throw new HostIdentityReconciliationException("HOST_IDENTITY_SELECTION_AMBIGUOUS", new InvalidOperationException("Select one formula object."));
                    object reflectedShape = reflectedRange.GetType().InvokeMember(
                        "Item",
                        System.Reflection.BindingFlags.GetProperty |
                        System.Reflection.BindingFlags.InvokeMethod,
                        null,
                        reflectedRange,
                        new object[] { 1 });
                    if (reflectedShape != null) return reflectedShape;
                }
                catch (HostIdentityReconciliationException) { throw; }
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
                    if (range != null && range.Count > 1) throw new HostIdentityReconciliationException("HOST_IDENTITY_SELECTION_AMBIGUOUS", new InvalidOperationException("Select one formula object."));
                    if (range != null && range.Count == 1) return range.Item(1);
                }
                catch (HostIdentityReconciliationException) { throw; }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("resolve-selected-shape-direct-range", "excel", null, ex);
                }

                try
                {
                    dynamic item = selected.Item(1);
                    dynamic range = item.ShapeRange;
                    if (range != null && range.Count > 1) throw new HostIdentityReconciliationException("HOST_IDENTITY_SELECTION_AMBIGUOUS", new InvalidOperationException("Select one formula object."));
                    if (range != null && range.Count == 1) return range.Item(1);
                }
                catch (HostIdentityReconciliationException) { throw; }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("resolve-selected-shape-item-range", "excel", null, ex);
                }
            }
            catch (HostIdentityReconciliationException) { throw; }
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
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("read-shape-name-for-match", "excel", formulaId, ex);
            }
            if (string.Equals(namedId, formulaId, StringComparison.Ordinal)) return true;
            return string.Equals(ExtractFormulaIdFromShapeMetadata(shape), formulaId, StringComparison.Ordinal);
        }

        private static bool IsManagedShape(dynamic shape)
        {
            string? name = null;
            try { name = shape.Name as string; }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("read-managed-shape-name", "excel", null, ex);
            }
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

        internal FormulaPayload ReconcileCopiedFormulaIdentity(object shape, FormulaPayload payload, object? automation)
        {
            Microsoft.Office.Interop.Excel.Worksheet? sheet = null;
            Microsoft.Office.Interop.Excel.Workbook? workbook = null;
            Microsoft.Office.Core.CustomXMLParts? parts = null;
            try
            {
                sheet = HostIdentityReconciliation.FindOwner<Microsoft.Office.Interop.Excel.Worksheet>(shape);
                workbook = (Microsoft.Office.Interop.Excel.Workbook)sheet.Parent; parts = workbook.CustomXMLParts;
                return HostIdentityReconciliation.ReconcileShape(parts, shape, payload, "excel",
                    "excel:" + workbook.FullName, workbook.ReadOnly,
                    (entries, id) => ManifestDiagnostics.ReadShapeInventory(workbook, false, entries).Count(value => value == id), automation);
            }
            catch (HostIdentityReconciliationException) { throw; }
            catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_RECONCILE_FAILED", error); }
            finally
            {
                if (parts != null) Marshal.ReleaseComObject(parts); if (workbook != null) Marshal.ReleaseComObject(workbook);
                if (sheet != null) Marshal.ReleaseComObject(sheet);
            }
        }

        /// <summary>
        /// Try to insert formula as an OLE object. Returns null if OLE is unavailable.
        /// </summary>
        private static void PersistManifest(Microsoft.Office.Interop.Excel.Workbook workbook, FormulaPayload payload)
        {
            var parts = workbook.CustomXMLParts;
            try { FormulaDocumentManifest.WriteEntry(parts, payload, "excel"); }
            finally { Marshal.ReleaseComObject(parts); }
        }

        private static InsertResult CommitManifest(Microsoft.Office.Interop.Excel.Workbook workbook,
            FormulaPayload payload, string mode, Action rollback)
        {
            var failure = HostManifestInsertion.Commit(payload.FormulaId, payload, "excel", mode,
                metadata => PersistManifest(workbook, metadata), rollback);
            return new InsertResult { Success = failure == null, FormulaId = payload.FormulaId, ActualStorageMode = mode,
                ErrorCode = failure?.ErrorCode, Error = failure?.Error };
        }

        private InsertResult? TryInsertOle(
            Microsoft.Office.Interop.Excel.Worksheet sheet,
            Microsoft.Office.Interop.Excel.Range cell,
            FormulaPayload payload,
            Microsoft.Office.Interop.Excel.Workbook workbook)
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
                    return CommitManifest(workbook, payload, "ole", () => ole.Delete());
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
            => DeleteCurrentDetailed().Success;

        public HostDeletionResult DeleteCurrentDetailed()
        {
            object? selection = null;
            try
            {
                selection = _application.Selection;
                if (selection is Microsoft.Office.Interop.Excel.ShapeRange shapeRange && shapeRange.Count == 1)
                {
                    var shape = shapeRange.Item(1);
                    try
                    {
                        string? id = ExtractFormulaIdFromShapeMetadata(shape) ?? ExtractFormulaIdFromShapeName(shape.Name);
                        if (!string.IsNullOrWhiteSpace(id)) return DeleteFormulaDetailed(id!);
                    }
                    finally { Marshal.ReleaseComObject(shape); }
                }
                return new HostDeletionResult { ErrorCode = "HOST_DELETE_SELECTION_AMBIGUOUS_OR_MISSING" };
            }
            catch (Exception ex) { return new HostDeletionResult { ErrorCode = "HOST_DELETE_FAILED", Error = ex.Message }; }
            finally { if (selection != null && Marshal.IsComObject(selection)) Marshal.ReleaseComObject(selection); }
        }

        /// <summary>
        /// Delete a formula by exact FormulaId. Scans all shapes for matching LSNO_ name.
        /// </summary>
        public bool DeleteFormula(string formulaId)
            => DeleteFormulaDetailed(formulaId).Success;

        public HostDeletionResult DeleteFormulaDetailed(string formulaId)
        {
            Microsoft.Office.Interop.Excel.Worksheet? sheet = null;
            Microsoft.Office.Interop.Excel.Workbook? book = null;
            Microsoft.Office.Interop.Excel.Shapes? shapes = null;
            Microsoft.Office.Core.CustomXMLParts? parts = null;
            try
            {
                sheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (sheet == null) return new HostDeletionResult { ErrorCode = "HOST_DELETE_TARGET_MISSING" };
                book = (Microsoft.Office.Interop.Excel.Workbook)sheet.Parent;
                if (book.ReadOnly) return new HostDeletionResult { ErrorCode = "HOST_DELETE_DOCUMENT_READ_ONLY" };
                shapes = sheet.Shapes; parts = book.CustomXMLParts;
                var entries = FormulaDocumentManifest.ReadAllEntries(parts);
                return HostFormulaDeletion.DeleteShape(parts, shapes, formulaId, "excel", value => ShapeMatchesFormulaId(value, formulaId),
                    () => ManifestDiagnostics.ReadShapeInventory(book, false, entries).Count(id => id == formulaId) == 1);
            }
            catch (Exception ex) { OfficeOperationLog.Failure("delete-formula", "excel", formulaId, ex); return new HostDeletionResult { ErrorCode = "HOST_DELETE_FAILED", Error = ex.Message }; }
            finally
            {
                if (shapes != null) Marshal.ReleaseComObject(shapes);
                if (parts != null) Marshal.ReleaseComObject(parts);
                if (book != null) Marshal.ReleaseComObject(book);
                if (sheet != null) Marshal.ReleaseComObject(sheet);
            }
        }

        public bool ReplaceFormula(string formulaId, FormulaPayload payload)
        {
            LastReplacementResult = ReplaceFormulaDetailed(formulaId, payload);
            return LastReplacementResult.Success;
        }

        public HostImageReplacementResult ReplaceFormulaDetailed(string formulaId, FormulaPayload payload)
        {
            var result = new HostImageReplacementResult { ErrorCode = "HOST_REPLACE_TARGET_MISSING" };
            Microsoft.Office.Interop.Excel.Shape? original = null, candidate = null;
            Microsoft.Office.Interop.Excel.Workbook? workbook = null;
            Microsoft.Office.Interop.Excel.Worksheet? excelSheet = null;
            Microsoft.Office.Interop.Excel.Shapes? shapes = null;
            Microsoft.Office.Core.CustomXMLParts? parts = null;
            string? tempPath = null;
            try
            {
                if (string.IsNullOrWhiteSpace(formulaId) || payload.FormulaId != formulaId)
                    throw new InvalidOperationException("HOST_REPLACE_ID_MISMATCH");
                excelSheet = _application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (excelSheet == null) return result;
                shapes = excelSheet.Shapes;
                int matches = 0;
                for (int index = 1; index <= shapes.Count; index++)
                {
                    var shape = shapes.Item(index);
                    if (ShapeMatchesFormulaId(shape, formulaId))
                    {
                        matches++;
                        if (original == null) original = shape;
                        else Marshal.ReleaseComObject(shape);
                    }
                    else Marshal.ReleaseComObject(shape);
                }
                if (matches != 1) throw new InvalidOperationException("HOST_REPLACE_TARGET_AMBIGUOUS_OR_MISSING");
                var target = original!;
                if (!HostPictureSnapshot.IsPicture(target))
                {
                    // An OLE replacement failure is not permission to delete it
                    // and silently insert a picture. Keep the existing route.
                    var automation = target.OLEFormat?.Object;
                    bool replaced = automation != null && OleFormulaInterop.ReplacePayloadJson(automation, payload);
                    if (replaced && OleFormulaInterop.TryGetExtentPoints(automation!, out var extent))
                    { target.Width = extent.DisplayWidthPt; target.Height = extent.DisplayHeightPt; }
                    result = new HostImageReplacementResult { Success = replaced, ActualStorageMode = "ole",
                        ErrorCode = replaced ? null : "HOST_OLE_REPLACE_FAILED" };
                    return result;
                }
                var snapshot = HostPictureSnapshot.Capture(target, excel: true, expectedFormulaId: formulaId);
                bool png = !string.IsNullOrWhiteSpace(payload.Render?.Png);
                if (!png && string.IsNullOrWhiteSpace(payload.Render?.Svg))
                    throw new InvalidOperationException("HOST_IMAGE_REPLACE_RENDER_MISSING");
                tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{Guid.NewGuid():N}." + (png ? "png" : "svg"));
                if (png) File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render!.Png!));
                else File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                workbook = (Microsoft.Office.Interop.Excel.Workbook)excelSheet.Parent;
                parts = workbook.CustomXMLParts;
                using (var store = FormulaDocumentManifest.OpenReplacementStore(parts))
                    result = HostImageReplacement.Replace(formulaId, payload, "excel", store,
                        () => candidate = shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue, target.Left, target.Top, target.Width, target.Height),
                        (value, metadata) => snapshot.Prepare(value, metadata), value => snapshot.Verify(value),
                        () => snapshot.Matches(target) && HostPictureSnapshot.CountTargets(shapes,
                            value => ShapeMatchesFormulaId(value, formulaId), candidate == null ? (int?)null : HostPictureSnapshot.GetId(candidate)) == 1,
                        () => HostPictureSnapshot.DeleteAndVerify(target, shapes), value => snapshot.Promote(value, formulaId),
                        value => HostPictureSnapshot.DeleteAndVerify(value, shapes));
                return result;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("replace-formula", "excel", formulaId, ex);
                return new HostImageReplacementResult { ErrorCode = "HOST_REPLACE_FAILED", Error = ex.Message };
            }
            finally
            {
                if (candidate != null) Marshal.ReleaseComObject(candidate);
                if (original != null) Marshal.ReleaseComObject(original);
                if (parts != null) Marshal.ReleaseComObject(parts);
                if (workbook != null) Marshal.ReleaseComObject(workbook);
                if (shapes != null) Marshal.ReleaseComObject(shapes);
                if (excelSheet != null) Marshal.ReleaseComObject(excelSheet);
                try { if (tempPath != null && File.Exists(tempPath)) File.Delete(tempPath); }
                catch (Exception cleanup) { OfficeOperationLog.Failure("delete-temp", "excel", formulaId, cleanup); }
            }
        }

        public HostImageReplacementResult? LastReplacementResult { get; private set; }

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
