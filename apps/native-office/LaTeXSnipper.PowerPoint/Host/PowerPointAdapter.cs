#nullable enable
using System;
using System.IO;
using System.Runtime.InteropServices;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using PowerPointApp = Microsoft.Office.Interop.PowerPoint.Application;

namespace LaTeXSnipper.PowerPoint.Host
{
    internal sealed class PowerPointAdapter : ICommandHostAdapter
    {
        private readonly PowerPointApp _application;
        private readonly int? _oleServerProcessId;
        private readonly Microsoft.Office.Interop.PowerPoint.Presentation? _targetPresentation;
        private readonly Microsoft.Office.Interop.PowerPoint.Slide? _targetSlide;

        public PowerPointAdapter(
            PowerPointApp application,
            int? oleServerProcessId = null,
            Microsoft.Office.Interop.PowerPoint.Presentation? targetPresentation = null,
            Microsoft.Office.Interop.PowerPoint.Slide? targetSlide = null)
        {
            _application = application;
            _oleServerProcessId = oleServerProcessId;
            if ((targetPresentation == null) != (targetSlide == null))
                throw new ArgumentException("Explicit PowerPoint insertion requires both presentation and slide.");
            if (targetSlide != null)
            {
                object parent = targetSlide.Parent;
                IntPtr parentIdentity = IntPtr.Zero, targetIdentity = IntPtr.Zero;
                try
                {
                    parentIdentity = Marshal.GetIUnknownForObject(parent);
                    targetIdentity = Marshal.GetIUnknownForObject(targetPresentation!);
                    if (parentIdentity != targetIdentity)
                        throw new ArgumentException("Explicit slide does not belong to the target presentation.");
                }
                finally
                {
                    if (parentIdentity != IntPtr.Zero) Marshal.Release(parentIdentity);
                    if (targetIdentity != IntPtr.Zero) Marshal.Release(targetIdentity);
                    Marshal.ReleaseComObject(parent);
                }
            }
            _targetPresentation = targetPresentation; _targetSlide = targetSlide;
        }

        public string HostType => "powerpoint";

        public string GetCurrentContextId()
        {
            var pres = _targetPresentation ?? _application.ActivePresentation;
            if (pres == null) return "powerpoint:unsaved:none";
            return "powerpoint:" + (pres.FullName ?? pres.Name);
        }

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            var pres = _targetPresentation ?? _application.ActivePresentation;
            if (pres == null)
                return new InsertResult { Success = false, Error = "No active presentation" };

            var slide = _targetSlide ?? _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
            if (slide == null)
                return new InsertResult { Success = false, Error = "No active slide" };

            try
            {
                string storageMode = payload.StorageMode ?? "auto";

                if (storageMode == "ole")
                {
                    var oleResult = TryInsertOle(slide, payload, pres);
                    if (oleResult != null && oleResult.Success)
                        return oleResult;
                    // P1-3: Return the actual error from TryInsertOle, not a generic message.
                    string error = oleResult?.Error ?? "OLE activation failed: unknown error";
                    return new InsertResult { Success = false, ErrorCode = oleResult?.ErrorCode, Error = error };
                }

                string? oleFallbackReason = null;
                if (storageMode == "auto")
                {
                    var oleResult = TryInsertOle(slide, payload, pres);
                    if (oleResult?.Success == true) return oleResult;
                    if (HostManifestInsertion.IsFailure(oleResult?.ErrorCode)) return oleResult!;
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
                    var meta = OleFormulaInterop.CreateHostMetadataJson(payload, "image");
                    shape.AlternativeText = meta;
                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] {imageData} shape added: name={shape.Name}, left={left}, top={top}, w={width}, h={height}");
                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] AlternativeText: {meta}");

                    // Clean up temp file after successful insertion
                    try { if (File.Exists(tempPath)) File.Delete(tempPath); }
                    catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "powerpoint", payload.FormulaId, ex); }
                    var imageResult = CommitManifest(pres, payload, "image", () => shape.Delete());
                    imageResult.FallbackReason = oleFallbackReason;
                    return imageResult;
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
        private static void PersistManifest(Microsoft.Office.Interop.PowerPoint.Presentation presentation, FormulaPayload payload)
        {
            var parts = presentation.CustomXMLParts;
            try { FormulaDocumentManifest.WriteEntry(parts, payload, "powerpoint"); }
            finally { Marshal.ReleaseComObject(parts); }
        }

        private static InsertResult CommitManifest(Microsoft.Office.Interop.PowerPoint.Presentation presentation,
            FormulaPayload payload, string mode, Action rollback)
        {
            var failure = HostManifestInsertion.Commit(payload.FormulaId, payload, "powerpoint", mode,
                metadata => PersistManifest(presentation, metadata), rollback);
            return new InsertResult { Success = failure == null, FormulaId = payload.FormulaId, ActualStorageMode = mode,
                ErrorCode = failure?.ErrorCode, Error = failure?.Error };
        }

        private InsertResult? TryInsertOle(Microsoft.Office.Interop.PowerPoint.Slide slide, FormulaPayload payload,
            Microsoft.Office.Interop.PowerPoint.Presentation presentation)
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

                float slideWidth = presentation.PageSetup.SlideWidth;
                float top = 100f;

                using (PendingPayloadLease payloadLease = _oleServerProcessId.HasValue
                    ? OleFormulaPendingPayloadStore.SaveForProcess(
                        payload,
                        _oleServerProcessId.Value)
                    : OleFormulaPendingPayloadStore.Save(payload))
                {
                    var shape = slide.Shapes.AddOLEObject(
                        Left: (slideWidth - 120f) / 2f,
                        Top: top,
                        ClassName: "LaTeXSnipper.Formula.1",
                        DisplayAsIcon: Microsoft.Office.Core.MsoTriState.msoFalse,
                        Link: Microsoft.Office.Core.MsoTriState.msoFalse
                    );

                    shape.Name = $"LSNO_{payload.FormulaId}";

                    using OleActivationResult activation = OleFormulaActivation.ActivateAndVerify(
                        () => shape.OLEFormat?.Object,
                        payload,
                        () => shape.Delete(),
                        OleRcwOwnership.OwnedTemporaryRcw);
                    if (!activation.Success)
                    {
                        return new InsertResult { Success = false, ErrorCode = activation.ErrorCode, Error = activation.Message };
                    }

                    // Query the OLE object's natural extent and compute display size with scale.
                    if (activation.AutomationObject == null ||
                        !OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints naturalExtent))
                    {
                        shape.Delete();
                        return new InsertResult { Success = false, ErrorCode = "OLE_EXTENT_UNAVAILABLE", Error = "The OLE object did not expose a valid natural extent." };
                    }

                    OleExtentPoints targetExtent = OleFormulaInterop.GetInitialDisplayExtent(payload, naturalExtent, OleHostKind.PowerPoint);

                    // Constrain to slide dimensions to prevent clipping at slide edges
                    float slideHeight = _application.ActivePresentation.PageSetup.SlideHeight;
                    const float horizontalMargin = 36.0f;
                    const float bottomMargin = 36.0f;
                    targetExtent = OleFormulaInterop.FitDisplayExtent(targetExtent,
                        Math.Max(36.0f, slideWidth - horizontalMargin * 2.0f),
                        Math.Max(36.0f, slideHeight - top - bottomMargin));

                    // Deselect so the host can finalize the OLE object
                    _application.ActiveWindow.Selection.Unselect();

                    // CompleteInsertion BEFORE setting Width/Height so SetExtent is no longer ignored
                    if (!OleFormulaInterop.CompleteInsertion(activation.AutomationObject))
                    {
                        shape.Delete();
                        return new InsertResult { Success = false, ErrorCode = "OLE_COMPLETE_INSERTION_FAILED", Error = "OLE object did not complete insertion." };
                    }

                    string? extentFallbackReason = null;
                    bool synchronized = OleFormulaInterop.TrySetDisplayExtent(activation.AutomationObject, targetExtent) &&
                        OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints synchronizedExtent) &&
                        OleFormulaInterop.DisplayExtentMatches(targetExtent, synchronizedExtent);
                    if (!synchronized)
                    {
                        targetExtent = new OleExtentPoints(
                            naturalExtent.NaturalWidthPt,
                            naturalExtent.NaturalHeightPt,
                            naturalExtent.NaturalWidthPt,
                            naturalExtent.NaturalHeightPt);
                        OleFormulaInterop.TrySetDisplayExtent(activation.AutomationObject, targetExtent);
                        extentFallbackReason = "OLE_EXTENT_SYNC_FALLBACK: native display extent synchronization failed; natural size was used.";
                        System.Diagnostics.Debug.WriteLine(
                            "[PPTAdapter] OLE_EXTENT_SYNC_FALLBACK: using natural-size host Shape because explicit server synchronization failed.");
                    }

                    // Now set final dimensions — SetExtent accepts them after CompleteInsertion
                    shape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
                    shape.Width = targetExtent.DisplayWidthPt;
                    shape.Height = targetExtent.DisplayHeightPt;
                    shape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                    shape.Left = (slideWidth - shape.Width) / 2f;

                    if (OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints verifiedExtent) &&
                        !OleFormulaInterop.DisplayExtentMatches(targetExtent, verifiedExtent))
                    {
                        shape.Width = naturalExtent.NaturalWidthPt;
                        shape.Height = naturalExtent.NaturalHeightPt;
                        shape.Left = (slideWidth - shape.Width) / 2f;
                        extentFallbackReason = "OLE_EXTENT_VERIFY_FALLBACK: native display extent did not match the host Shape; natural size was used.";
                        System.Diagnostics.Debug.WriteLine(
                            "[PPTAdapter] OLE_EXTENT_VERIFY_FALLBACK: native display extent did not match the host Shape.");
                    }

                    // PowerPoint may recreate the host shape while finalizing the OLE
                    // cache. Write fallback metadata only after CompleteInsertion and
                    // extent synchronization so it survives selection readback.
                    shape.AlternativeText = OleFormulaInterop.CreateHostMetadataJson(payload);

                    System.Diagnostics.Debug.WriteLine($"[PPTAdapter] OLE object inserted and initialized: name={shape.Name}");
                    var result = CommitManifest(presentation, payload, "ole", () => shape.Delete());
                    result.FallbackReason = extentFallbackReason;
                    return result;
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
                foreach (Microsoft.Office.Interop.PowerPoint.Shape candidate in slide.Shapes)
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
            LastReplacementResult = ReplaceFormulaDetailed(formulaId, payload);
            return LastReplacementResult.Success;
        }

        public HostImageReplacementResult ReplaceFormulaDetailed(string formulaId, FormulaPayload payload)
        {
            var result = new HostImageReplacementResult { ErrorCode = "HOST_REPLACE_TARGET_MISSING" };
            Microsoft.Office.Interop.PowerPoint.Shape? original = null, candidate = null;
            Microsoft.Office.Interop.PowerPoint.Shapes? shapes = null;
            Microsoft.Office.Interop.PowerPoint.Slide? slide = null;
            Microsoft.Office.Interop.PowerPoint.Presentation? presentation = null;
            Microsoft.Office.Core.CustomXMLParts? parts = null;
            string? tempPath = null;
            try
            {
                if (string.IsNullOrWhiteSpace(formulaId) || payload.FormulaId != formulaId)
                    throw new InvalidOperationException("HOST_REPLACE_ID_MISMATCH");
                presentation = _targetPresentation ?? _application.ActivePresentation;
                slide = _targetSlide ?? _application.ActiveWindow.View.Slide as Microsoft.Office.Interop.PowerPoint.Slide;
                if (slide == null || presentation == null) return result;
                shapes = slide.Shapes;
                int matches = 0;
                for (int index = 1; index <= shapes.Count; index++)
                {
                    var shape = shapes[index];
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
                    // Do not turn an uncertain OLE mutation into a second route.
                    var automation = target.OLEFormat?.Object;
                    bool replaced = automation != null && OleFormulaInterop.ReplacePayloadJson(automation, payload);
                    if (replaced && OleFormulaInterop.TryGetExtentPoints(automation!, out var extent))
                    { target.Width = extent.DisplayWidthPt; target.Height = extent.DisplayHeightPt; }
                    result = new HostImageReplacementResult { Success = replaced, ActualStorageMode = "ole",
                        ErrorCode = replaced ? null : "HOST_OLE_REPLACE_FAILED" };
                    return result;
                }
                var snapshot = HostPictureSnapshot.Capture(target, excel: false, expectedFormulaId: formulaId);
                bool png = !string.IsNullOrWhiteSpace(payload.Render?.Png);
                if (!png && string.IsNullOrWhiteSpace(payload.Render?.Svg))
                    throw new InvalidOperationException("HOST_IMAGE_REPLACE_RENDER_MISSING");
                tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{Guid.NewGuid():N}." + (png ? "png" : "svg"));
                if (png) File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render!.Png!));
                else File.WriteAllText(tempPath, payload.Render!.Svg!, new System.Text.UTF8Encoding(false));
                parts = presentation.CustomXMLParts;
                using (var store = FormulaDocumentManifest.OpenReplacementStore(parts))
                    result = HostImageReplacement.Replace(formulaId, payload, "powerpoint", store,
                        () => candidate = shapes.AddPicture(tempPath, Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue, target.Left, target.Top, target.Width, target.Height),
                        (value, metadata) => snapshot.Prepare(value, metadata), value => snapshot.Verify(value),
                        () => snapshot.Matches(target) && HostPictureSnapshot.CountTargets(shapes,
                            value => ShapeMatchesFormulaId((Microsoft.Office.Interop.PowerPoint.Shape)value, formulaId),
                            candidate == null ? (int?)null : HostPictureSnapshot.GetId(candidate)) == 1,
                        () => HostPictureSnapshot.DeleteAndVerify(target, shapes), value => snapshot.Promote(value, formulaId),
                        value => HostPictureSnapshot.DeleteAndVerify(value, shapes));
                return result;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("replace-formula", "powerpoint", formulaId, ex);
                return new HostImageReplacementResult { ErrorCode = "HOST_REPLACE_FAILED", Error = ex.Message };
            }
            finally
            {
                if (candidate != null) Marshal.ReleaseComObject(candidate);
                if (original != null) Marshal.ReleaseComObject(original);
                if (parts != null) Marshal.ReleaseComObject(parts);
                if (shapes != null) Marshal.ReleaseComObject(shapes);
                if (slide != null && _targetSlide == null) Marshal.ReleaseComObject(slide);
                if (presentation != null && _targetPresentation == null) Marshal.ReleaseComObject(presentation);
                try { if (tempPath != null && File.Exists(tempPath)) File.Delete(tempPath); }
                catch (Exception cleanup) { OfficeOperationLog.Failure("delete-temp", "powerpoint", formulaId, cleanup); }
            }
        }

        public HostImageReplacementResult? LastReplacementResult { get; private set; }

        private static bool ShapeMatchesFormulaId(Microsoft.Office.Interop.PowerPoint.Shape shape, string formulaId)
        {
            if (shape.Name == "LSNO_" + formulaId) return true;
            string text = shape.AlternativeText ?? "";
            if (!text.StartsWith("{", StringComparison.Ordinal)) return false;
            try
            {
                var metadata = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(text,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return metadata?.FormulaId == formulaId;
            }
            catch (System.Text.Json.JsonException error)
            {
                OfficeOperationLog.Failure("read-image-identity", "powerpoint", formulaId, error);
                return false;
            }
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
