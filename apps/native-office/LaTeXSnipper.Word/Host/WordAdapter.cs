#nullable enable
using System;
using System.Runtime.InteropServices;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using OmmlValidationResult = LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidationResult;
using OmmlValidator = LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidator;

namespace LaTeXSnipper.Word.Host
{
    internal sealed class WordAdapter : ICommandHostAdapter
    {
        private readonly Microsoft.Office.Interop.Word.Application _application;
        private readonly int? _oleServerProcessId;

        public WordAdapter(
            Microsoft.Office.Interop.Word.Application application,
            int? oleServerProcessId = null)
        {
            _application = application;
            _oleServerProcessId = oleServerProcessId;
        }

        public string HostType => "word";

        public string GetCurrentDocumentContextId()
        {
            return GetCurrentContextId();
        }

        public FormulaPayload? ReadSelection()
        {
            try
            {
                var range = _application.Selection.Range;
                if (range == null) return null;

                // Layer 0: OLE InlineShape — read full payload via COM automation
                try
                {
                    foreach (Microsoft.Office.Interop.Word.InlineShape inlineShape in range.InlineShapes)
                    {
                        if (inlineShape.Type == Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                        {
                            try
                            {
                                var oleObj = inlineShape.OLEFormat?.Object;
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
                                // Not our OLE object, skip
                            }
                        }
                    }
                }
                catch (Exception ex) { OfficeOperationLog.Failure("read-inline-ole", "word", null, ex); }

                // P1-5: Layer 0b: Cursor adjacency detection — if the cursor is immediately
                // before or after an InlineShape, range.InlineShapes may not include it.
                // Expand the range by 1 character in each direction and retry.
                try
                {
                    var doc = range.Document;
                    var expandedRange = doc.Range(
                        Math.Max(0, range.Start - 1),
                        Math.Min(doc.Content.End, range.End + 1));
                    foreach (Microsoft.Office.Interop.Word.InlineShape inlineShape in expandedRange.InlineShapes)
                    {
                        if (inlineShape.Type == Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                        {
                            try
                            {
                                var oleObj = inlineShape.OLEFormat?.Object;
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
                            catch (Exception ex) { OfficeOperationLog.Failure("read-adjacent-ole", "word", null, ex); }
                        }
                    }
                }
                catch (Exception ex) { OfficeOperationLog.Failure("read-adjacent-range", "word", null, ex); }

                // P1-5: Layer 0c: Fallback — search the entire Selection.InlineShapes
                // in case the selection object type differs from the range's shape collection.
                try
                {
                    foreach (Microsoft.Office.Interop.Word.InlineShape inlineShape in _application.Selection.InlineShapes)
                    {
                        if (inlineShape.Type == Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                        {
                            try
                            {
                                var oleObj = inlineShape.OLEFormat?.Object;
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
                            catch (Exception ex) { OfficeOperationLog.Failure("read-selection-ole", "word", null, ex); }
                        }
                    }
                }
                catch (Exception ex) { OfficeOperationLog.Failure("scan-selection-ole", "word", null, ex); }

                // Find formulaId from ContentControl tag first
                var existingFormulaId = Metadata.FormulaMetadata.FindFormulaIdAtRange(range);

                // If we have a formulaId, try to read from manifest
                if (!string.IsNullOrEmpty(existingFormulaId))
                {
                    var doc = range.Document;
                    var fromManifest = FormulaDocumentManifest.Read(doc, existingFormulaId);
                    if (fromManifest != null)
                    {
                        // Also read fresh OMML from the document for latest state
                        fromManifest.FormulaId = existingFormulaId;
                        return fromManifest;
                    }
                }

                // Layer 1: OMath collection (cursor inside math zone)
                if (range.OMaths.Count > 0)
                {
                    try
                    {
                        var oMath = range.OMaths[1];

                        // Get OMML from WordOpenXML
                        var oMathXml = oMath.Range.WordOpenXML;
                        if (!string.IsNullOrEmpty(oMathXml))
                        {
                            var omml = ExtractOmmlFromXml(oMathXml);
                            if (!string.IsNullOrEmpty(omml))
                            {
                                return new FormulaPayload
                                {
                                    FormulaId = existingFormulaId ?? FormulaIdHelper.NewId(),
                                    Omml = omml,
                                    Latex = "",
                                    Display = "block"
                                };
                            }
                        }
                    }
                    catch (Exception ex) { OfficeOperationLog.Failure("read-content-control", "word", existingFormulaId, ex); }
                }

                // Layer 2: Range.WordOpenXML → find nearest <m:oMath>
                try
                {
                    var xml = range.WordOpenXML;
                    if (!string.IsNullOrEmpty(xml))
                    {
                        var omml = ExtractOmmlFromXml(xml);
                        if (!string.IsNullOrEmpty(omml))
                        {
                            return new FormulaPayload
                            {
                                FormulaId = existingFormulaId ?? FormulaIdHelper.NewId(),
                                Omml = omml,
                                Latex = "",
                                Display = "block"
                            };
                        }
                    }
                }
                catch (Exception ex) { OfficeOperationLog.Failure("read-omml", "word", existingFormulaId, ex); }

                // Layer 3: Clipboard fallback
                if (_application.Selection.OMaths.Count > 0)
                {
                    try
                    {
                        var oMath = _application.Selection.OMaths[1];
                        oMath.Range.Copy();
                        var clipXml = System.Windows.Forms.Clipboard.GetData("XML") as string;
                        if (!string.IsNullOrEmpty(clipXml))
                        {
                            var omml = ExtractOmmlFromXml(clipXml);
                            if (!string.IsNullOrEmpty(omml))
                            {
                                return new FormulaPayload
                                {
                                    FormulaId = existingFormulaId ?? FormulaIdHelper.NewId(),
                                    Omml = omml,
                                    Latex = "",
                                    Display = "block"
                                };
                            }
                        }
                    }
                    catch (Exception ex) { OfficeOperationLog.Failure("read-selection-image", "word", existingFormulaId, ex); }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] ReadSelection error: {ex.Message}");
            }

            return null;
        }

        private static string ExtractOmmlFromXml(string xml)
        {
            if (string.IsNullOrEmpty(xml)) return null;

            int oMathStart = -1;
            string closeTag = "";

            // Prefer full <m:oMathPara>; fallback to <m:oMath>
            var paraStart = xml.IndexOf("<m:oMathPara");
            if (paraStart >= 0)
            {
                oMathStart = paraStart;
                closeTag = "</m:oMathPara>";
            }
            else
            {
                var mathStart = xml.IndexOf("<m:oMath");
                if (mathStart >= 0)
                {
                    var afterTag = xml.Substring(mathStart + 8, 1);
                    // Allow '>' for <m:oMath>; skip 'P' (already handled above for <m:oMathPara>)
                    if (afterTag != "P")
                    {
                        oMathStart = mathStart;
                        closeTag = "</m:oMath>";
                    }
                }
            }

            if (oMathStart < 0) return null;

            var endTag = xml.IndexOf(closeTag, oMathStart);
            if (endTag < 0) return null;

            return xml.Substring(oMathStart, endTag + closeTag.Length - oMathStart);
        }

        public InsertResult DeleteCurrent()
        {
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null)
                    return new InsertResult { Success = false, Error = "No active document" };

                var sel = _application.Selection;
                if (sel == null)
                    return new InsertResult { Success = false, Error = "No selection" };

                // Check if current selection is inside a LaTeXSnipper Content Control
                var cc = sel.Range.ContentControls;
                if (cc != null && cc.Count > 0)
                {
                    var control = cc[1];
                    var tag = control.Tag as string;
                    if (!string.IsNullOrEmpty(tag) && tag.StartsWith("latexsnipper:"))
                    {
                        control.Delete(true);
                        return new InsertResult { Success = true };
                    }
                }

                // Also check OMath inside LSNO content control (for deep cursor positions)
                if (sel.OMaths.Count > 0)
                {
                    var parentCc = FindParentLsnContentControl(sel.Range);
                    if (parentCc != null)
                    {
                        parentCc.Delete(true);
                        return new InsertResult { Success = true };
                    }
                }

                return new InsertResult { Success = false, Error = "No LaTeXSnipper formula selected" };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Delete a formula by exact FormulaId. Finds ContentControl with matching tag.
        /// </summary>
        public InsertResult DeleteFormula(string formulaId)
        {
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null)
                    return new InsertResult { Success = false, Error = "No active document" };

                string targetTag = $"latexsnipper:formula:{formulaId}";
                foreach (Microsoft.Office.Interop.Word.ContentControl cc in doc.ContentControls)
                {
                    var tag = cc.Tag as string;
                    if (string.Equals(tag, targetTag, StringComparison.Ordinal))
                    {
                        cc.Delete(true);
                        return new InsertResult { Success = true };
                    }
                }

                return new InsertResult { Success = false, Error = $"Formula {formulaId} not found" };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        private static Microsoft.Office.Interop.Word.ContentControl FindParentLsnContentControl(
            Microsoft.Office.Interop.Word.Range range)
        {
            // Walk up the content control hierarchy
            var parent = range.ParentContentControl;
            if (parent != null)
            {
                var tag = parent.Tag as string;
                if (!string.IsNullOrEmpty(tag) && tag.StartsWith("latexsnipper:"))
                    return parent;
            }
            return null;
        }

        public InsertResult ReplaceFormula(string formulaId, FormulaPayload newPayload)
        {
            Microsoft.Office.Interop.Word.ContentControl candidate = null;
            Microsoft.Office.Interop.Word.Document doc = null;
            FormulaPayload originalManifest = null;
            string candidateId = FormulaIdHelper.NewId();
            try
            {
                doc = _application.ActiveDocument;
                if (doc == null) return new InsertResult { Success = false, Error = "No document" };

                string targetTag = $"latexsnipper:formula:{formulaId}";
                originalManifest = FormulaDocumentManifest.Read(doc, formulaId);
                if (originalManifest != null &&
                    newPayload.Revision != originalManifest.Revision)
                {
                    return new InsertResult
                    {
                        Success = false,
                        ErrorCode = "OFFICE_TARGET_CHANGED",
                        Error = $"Formula revision changed from {newPayload.Revision} to {originalManifest.Revision}."
                    };
                }

                foreach (Microsoft.Office.Interop.Word.ContentControl cc in doc.ContentControls)
                {
                    if (!string.Equals(cc.Tag as string, targetTag, StringComparison.Ordinal))
                        continue;

                    Microsoft.Office.Interop.Word.InlineShape originalOleShape = null;
                    foreach (Microsoft.Office.Interop.Word.InlineShape shape in cc.Range.InlineShapes)
                    {
                        if (shape.Type == Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                        {
                            originalOleShape = shape;
                            break;
                        }
                    }

                    var originalRange = cc.Range.Duplicate;
                    int originalStart = originalRange.Start;
                    int originalEnd = originalRange.End;
                    float originalWidth = originalOleShape?.Width ?? 0;
                    float originalHeight = originalOleShape?.Height ?? 0;

                    var mode = ParseInsertMode(newPayload.Display);
                    string requestedFormulaId = newPayload.FormulaId;
                    newPayload.FormulaId = candidateId;
                    if (originalOleShape != null)
                        newPayload.StorageMode = "ole";
                    else if (originalManifest != null && !string.IsNullOrWhiteSpace(originalManifest.StorageMode))
                        newPayload.StorageMode = originalManifest.StorageMode;

                    var candidatePoint = doc.Range(originalEnd, originalEnd);
                    candidatePoint.Select();
                    var inserted = InsertFormula(newPayload, mode);
                    if (!inserted.Success)
                    {
                        newPayload.FormulaId = requestedFormulaId;
                        return new InsertResult
                        {
                            Success = false,
                            ErrorCode = inserted.ErrorCode ?? "CANDIDATE_CREATE_FAILED",
                            Error = inserted.Error ?? "Candidate formula creation failed."
                        };
                    }

                    candidate = FindFormulaContentControl(doc, candidateId);
                    if (candidate == null || candidate.Range.Start < originalEnd)
                        throw new InvalidOperationException("Candidate formula ownership could not be read back.");

                    Microsoft.Office.Interop.Word.InlineShape candidateOleShape = null;
                    if (originalOleShape != null)
                    {
                        foreach (Microsoft.Office.Interop.Word.InlineShape shape in candidate.Range.InlineShapes)
                        {
                            if (shape.Type == Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                            {
                                candidateOleShape = shape;
                                break;
                            }
                        }
                        if (candidateOleShape == null)
                            throw new InvalidOperationException("Candidate OLE object was not created.");

                        newPayload.FormulaId = formulaId;
                        newPayload = OleFormulaInterop.NormalizeForOle(newPayload);
                        object automationObject = candidateOleShape.OLEFormat?.Object;
                        if (automationObject == null ||
                            !OleFormulaInterop.ReplacePayloadJson(automationObject, newPayload))
                            throw new InvalidOperationException("Candidate OLE payload verification failed.");
                        if (!OleFormulaInterop.TryGetExtentPoints(automationObject, out OleExtentPoints naturalExtent))
                            return RollbackCandidate(
                                doc,
                                candidate,
                                originalManifest,
                                formulaId,
                                "OLE_EXTENT_UNAVAILABLE",
                                "Candidate OLE extent was unavailable.");

                        OleExtentPoints targetExtent = OleFormulaInterop.GetInitialDisplayExtent(newPayload, naturalExtent, OleHostKind.Word);
                        if (!OleFormulaInterop.TrySetDisplayExtent(automationObject, targetExtent))
                            return RollbackCandidate(
                                doc,
                                candidate,
                                originalManifest,
                                formulaId,
                                "OLE_EXTENT_VERIFY_FAILED",
                                "Candidate OLE display extent could not be verified.");
                        candidateOleShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
                        candidateOleShape.Width = originalWidth > 0 ? originalWidth : targetExtent.DisplayWidthPt;
                        candidateOleShape.Height = originalHeight > 0 ? originalHeight : targetExtent.DisplayHeightPt;
                        candidateOleShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                    }
                    else
                    {
                        newPayload.FormulaId = formulaId;
                    }

                    candidate.Tag = targetTag;
                    candidate.Title = "LaTeXSnipper Formula";
                    try
                    {
                        candidate.Appearance = Microsoft.Office.Interop.Word.WdContentControlAppearance.wdContentControlHidden;
                    }
                    catch (Exception appearanceError)
                    {
                        OfficeOperationLog.Failure(
                            "hide-replacement-content-control",
                            "word",
                            formulaId,
                            appearanceError);
                    }
                    newPayload.Revision = Math.Max(newPayload.Revision, originalManifest?.Revision ?? 0) + 1;
                    FormulaDocumentManifest.Write(doc, newPayload);
                    FormulaDocumentManifest.Remove(doc, candidateId);
                    var committedRange = candidate.Range.Duplicate;

                    try
                    {
                        cc.LockContents = false;
                        cc.LockContentControl = false;
                        cc.Delete(true);
                    }
                    catch (Exception deleteError)
                    {
                        RestoreManifest(doc, originalManifest, formulaId);
                        return RollbackCandidate(
                            doc,
                            candidate,
                            originalManifest,
                            formulaId,
                            "ORIGINAL_DELETE_FAILED",
                            deleteError.Message);
                    }

                    // The original is gone at this point. Selection is best-effort and
                    // must never turn a successful commit into a destructive rollback.
                    try
                    {
                        committedRange.Select();
                    }
                    catch (Exception selectionError)
                    {
                        OfficeOperationLog.Failure(
                            "select-replacement-content-control",
                            "word",
                            formulaId,
                            selectionError);
                    }
                    return new InsertResult
                    {
                        Success = true,
                        FormulaId = formulaId,
                        RangeStart = (uint)committedRange.Start,
                        RangeEnd = (uint)committedRange.End,
                        StorageMode = newPayload.StorageMode,
                        Revision = newPayload.Revision
                    };
                }

                return new InsertResult { Success = false, Error = $"Formula {formulaId} not found" };
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("candidate-first-replace", "word", formulaId, ex);
                if (doc != null && candidate != null)
                    return RollbackCandidate(
                        doc,
                        candidate,
                        originalManifest,
                        formulaId,
                        "CANDIDATE_VALIDATION_FAILED",
                        ex.Message);
                return new InsertResult
                {
                    Success = false,
                    ErrorCode = "CANDIDATE_CREATE_FAILED",
                    Error = ex.Message
                };
            }
        }

        public FormulaPayload? ReadFormulaById(string formulaId)
        {
            if (string.IsNullOrWhiteSpace(formulaId)) return null;
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null) return null;

                var manifest = FormulaDocumentManifest.Read(doc, formulaId);
                if (manifest != null) return manifest;

                var control = FindFormulaContentControl(doc, formulaId);
                if (control == null) return null;
                foreach (Microsoft.Office.Interop.Word.InlineShape shape in control.Range.InlineShapes)
                {
                    if (shape.Type != Microsoft.Office.Interop.Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                        continue;
                    var automationObject = shape.OLEFormat?.Object;
                    var json = automationObject == null ? null : OleFormulaInterop.GetPayloadJson(automationObject);
                    var payload = string.IsNullOrWhiteSpace(json)
                        ? null
                        : System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(json,
                            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (payload != null && string.Equals(payload.FormulaId, formulaId, StringComparison.Ordinal))
                        return payload;
                }

                var omml = ExtractOmmlFromXml(control.Range.WordOpenXML);
                return string.IsNullOrWhiteSpace(omml)
                    ? null
                    : new FormulaPayload { FormulaId = formulaId, Omml = omml, StorageMode = "native-omml" };
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("read-formula-by-id", "word", formulaId, ex);
                return null;
            }
        }

        private static InsertMode ParseInsertMode(string display)
        {
            if (string.Equals(display, "numbered", StringComparison.Ordinal) ||
                string.Equals(display, "displayNumbered", StringComparison.Ordinal))
                return InsertMode.DisplayNumbered;
            return string.Equals(display, "inline", StringComparison.Ordinal)
                ? InsertMode.Inline
                : InsertMode.Display;
        }

        private static Microsoft.Office.Interop.Word.ContentControl FindFormulaContentControl(
            Microsoft.Office.Interop.Word.Document document,
            string formulaId)
        {
            string tag = $"latexsnipper:formula:{formulaId}";
            Microsoft.Office.Interop.Word.ContentControls controls = null;
            try
            {
                controls = document.ContentControls;
                for (int index = 1; index <= controls.Count; index++)
                {
                    Microsoft.Office.Interop.Word.ContentControl control = controls[index];
                    if (string.Equals(control.Tag as string, tag, StringComparison.Ordinal))
                        return control;
                    ReleaseLocalComObject(control);
                }
                return null;
            }
            finally
            {
                ReleaseLocalComObject(controls);
            }
        }

        private static void ReleaseLocalComObject(object value)
        {
            if (value == null || !Marshal.IsComObject(value))
                return;
            try { Marshal.ReleaseComObject(value); }
            catch (InvalidComObjectException) { return; }
        }

        private static void RestoreManifest(
            Microsoft.Office.Interop.Word.Document document,
            FormulaPayload original,
            string formulaId)
        {
            try
            {
                if (original != null)
                    FormulaDocumentManifest.Write(document, original);
                else
                    FormulaDocumentManifest.Remove(document, formulaId);
            }
            catch (Exception restoreError)
            {
                OfficeOperationLog.Failure(
                    "restore-replacement-manifest",
                    "word",
                    formulaId,
                    restoreError);
            }
        }

        private static InsertResult RollbackCandidate(
            Microsoft.Office.Interop.Word.Document document,
            Microsoft.Office.Interop.Word.ContentControl candidate,
            FormulaPayload originalManifest,
            string formulaId,
            string errorCode,
            string error)
        {
            try
            {
                if (candidate != null)
                {
                    candidate.LockContents = false;
                    candidate.LockContentControl = false;
                    candidate.Delete(true);
                }
            }
            catch (Exception cleanupError)
            {
                OfficeOperationLog.Failure(
                    "cleanup-replacement-candidate",
                    "word",
                    formulaId,
                    cleanupError);
            }
            RestoreManifest(document, originalManifest, formulaId);
            return new InsertResult
            {
                Success = false,
                ErrorCode = errorCode,
                Error = error
            };
        }

        public void InsertText(string value)
        {
            System.Diagnostics.Debug.WriteLine(
                "[WordAdapter] InsertText called.");
            _application.Selection.TypeText(value);
        }

        public string GetCurrentContextId()
        {
            var document = _application.ActiveDocument;
            if (document == null)
                return "word:unsaved:none";
            var fullName = document.FullName;
            if (!string.IsNullOrWhiteSpace(fullName))
                return "word:" + fullName;
            return "word:" + document.Name;
        }

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            var doc = _application.ActiveDocument;
            if (doc == null)
                return new InsertResult { Success = false, Error = "No active document" };

            var range = _application.Selection.Range;

            try
            {
                string storageMode = payload.StorageMode ?? "auto";

                if (storageMode == "ole")
                {
                    return InsertOleObject(doc, range, payload, mode);
                }

                if (storageMode == "image")
                {
                    return InsertImageObject(doc, range, payload, mode);
                }

                // Default: native OMML (also "auto" and "native-omml")
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] OMML to insert: [{payload.Omml}]");

                if (mode == InsertMode.Inline)
                {
                    return InsertWordInlineNative(doc, range, payload);
                }

                var cleanOmml = NormalizeOmml(payload.Omml, mode);
                if (string.IsNullOrWhiteSpace(cleanOmml))
                    return new InsertResult { Success = false, Error = "OMML conversion returned empty content" };
                var preInsertValidation = OmmlValidator.Validate(cleanOmml);
                if (!preInsertValidation.IsValid)
                    return OmmlValidationFailure(preInsertValidation, "OMML failed pre-insert validation.");
                range = range.Duplicate;
                range.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseStart);

                var body = mode == InsertMode.DisplayNumbered
                    ? BuildNumberedEquationBody(cleanOmml, payload.FormulaId, GetContainerWidthTwips(range))
                    : BuildFormulaBody(cleanOmml, payload.FormulaId, mode);
                var flatOpc = BuildFlatOpc(body);

                range = NormalizeToBlockInsertionPoint(range);
                range.InsertXML(flatOpc);

                var candidate = FindFormulaContentControl(doc, payload.FormulaId);
                var readBackResult = ValidateNativeCandidate(candidate, cleanOmml);
                if (!readBackResult.IsValid)
                    return RollbackInvalidNativeCandidate(
                        doc,
                        candidate,
                        payload.FormulaId,
                        readBackResult);

                FormulaDocumentManifest.Write(doc, payload);
                var committedRange = candidate.Range.Duplicate;

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)committedRange.Start,
                    RangeEnd = (uint)committedRange.End
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] InsertFormula error: {ex.Message}");
                return new InsertResult
                {
                    Success = false,
                    Error = $"Insert failed: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Inserts an inline native OMML candidate through Flat OPC InsertXML,
        /// then validates WordOpenXML before committing formula metadata.
        /// </summary>
        private InsertResult InsertWordInlineNative(Microsoft.Office.Interop.Word.Document doc, Microsoft.Office.Interop.Word.Range range, FormulaPayload payload)
        {
            try
            {
                // Inline formula: insert OMML directly without <w:p> wrapper.
                // Using InsertXML with a bare <m:oMath> fragment avoids the block-level
                // XML error that occurs when <w:p>-containing Flat OPC is inserted inline.
                var cleanOmml = NormalizeOmml(payload.Omml ?? "", InsertMode.Inline);
                if (!string.IsNullOrWhiteSpace(cleanOmml))
                {
                    // Strip any <m:oMathPara> wrapper — keep only <m:oMath>
                    var mathOnly = cleanOmml;
                    if (mathOnly.Contains("<m:oMathPara"))
                    {
                        var start = mathOnly.IndexOf("<m:oMath");
                        while (start >= 0 && start + 10 < mathOnly.Length && mathOnly[start + 10] == 'P')
                            start = mathOnly.IndexOf("<m:oMath", start + 1);
                        var end = mathOnly.LastIndexOf("</m:oMath>");
                        if (start >= 0 && end > start)
                            mathOnly = mathOnly.Substring(start, end + "</m:oMath>".Length - start);
                    }
                    mathOnly = EnsureStandaloneMathNamespace(mathOnly);
                    var preInsertValidation = OmmlValidator.Validate(mathOnly);
                    if (!preInsertValidation.IsValid)
                        return OmmlValidationFailure(
                            preInsertValidation,
                            "Inline OMML failed pre-insert validation.");
                    range = range.Duplicate;
                    range.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseStart);

                    // Word only accepts OMML through a block-level Flat OPC package.
                    // Materialize it in a scratch paragraph, copy the exact OMath
                    // FormattedText to the requested run position, then wrap that
                    // precise range in an inline content control.
                    var candidate = InsertInlineOmmlViaScratch(
                        doc,
                        range,
                        mathOnly,
                        payload.FormulaId);
                    var readBackResult = ValidateNativeCandidate(candidate, mathOnly);
                    if (!readBackResult.IsValid)
                        return RollbackInvalidNativeCandidate(
                            doc,
                            candidate,
                            payload.FormulaId,
                            readBackResult);

                    FormulaDocumentManifest.Write(doc, payload);
                    var committedRange = candidate.Range.Duplicate;

                    return new InsertResult
                    {
                        Success = true,
                        FormulaId = payload.FormulaId,
                        StorageMode = "native-omml",
                        RangeStart = (uint)committedRange.Start,
                        RangeEnd = (uint)committedRange.End
                    };
                }

                return new InsertResult
                {
                    Success = false,
                    ErrorCode = "INLINE_OMML_REQUIRED",
                    Error = "Native inline insertion requires non-empty OMML; no text fallback was committed."
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WordAdapter] InsertWordInlineNative error: {ex.Message}");
                return new InsertResult { Success = false, Error = $"Inline formula insert failed: {ex.Message}" };
            }
        }

        private static Microsoft.Office.Interop.Word.ContentControl InsertInlineOmmlViaScratch(
            Microsoft.Office.Interop.Word.Document document,
            Microsoft.Office.Interop.Word.Range target,
            string mathOnly,
            string formulaId)
        {
            int targetStart = target.Start;
            string scratchId = formulaId + "-inline-scratch-" + Guid.NewGuid().ToString("N");
            Microsoft.Office.Interop.Word.ContentControl scratchCandidate = null;
            Microsoft.Office.Interop.Word.Range scratchParagraph = null;
            try
            {
                var scratch = document.Range(
                    document.Content.End - 1,
                    document.Content.End - 1);
                scratch.InsertParagraphAfter();
                scratch = document.Range(
                    document.Content.End - 1,
                    document.Content.End - 1);
                scratchParagraph = scratch.Paragraphs[1].Range.Duplicate;
                scratch.InsertXML(BuildFlatOpc(
                    BuildFormulaBody(mathOnly, scratchId, InsertMode.Inline)));
                scratchCandidate = FindFormulaContentControl(document, scratchId);
                if (scratchCandidate == null || scratchCandidate.Range.OMaths.Count != 1)
                    throw new InvalidOperationException(
                        "Word scratch conversion did not create exactly one OMath.");

                var sourceMath = scratchCandidate.Range.OMaths[1].Range.Duplicate;
                int sourceLength = sourceMath.End - sourceMath.Start;
                if (sourceLength <= 0)
                    throw new InvalidOperationException(
                        "Word scratch conversion returned an empty OMath range.");

                var destination = document.Range(targetStart, targetStart);
                destination.FormattedText = sourceMath.FormattedText;
                var insertedProbe = document.Range(
                    targetStart,
                    Math.Min(document.Content.End - 1, targetStart + sourceLength));
                if (insertedProbe.OMaths.Count != 1)
                    throw new InvalidOperationException(
                        "Word did not preserve one OMath while copying formatted math.");

                // Re-read the actual target OMath instead of trusting the source
                // scratch length. Word can include a scratch paragraph boundary in
                // the copied source range; a run-level content control must never
                // own that boundary.
                var insertedMath = insertedProbe.OMaths[1].Range.Duplicate;
                int insertedEnd = insertedMath.End;
                while (insertedEnd > insertedMath.Start)
                {
                    string trailing = document.Range(insertedEnd - 1, insertedEnd).Text;
                    if (trailing != "\r" && trailing != "\a")
                        break;
                    insertedEnd--;
                }
                insertedMath.SetRange(insertedMath.Start, insertedEnd);
                if (insertedMath.End <= insertedMath.Start || insertedMath.OMaths.Count != 1)
                    throw new InvalidOperationException(
                        "Word target OMath range was empty after removing paragraph boundaries.");

                var candidate = document.ContentControls.Add(
                    Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                    insertedMath);
                candidate.Tag = "latexsnipper:formula:" + formulaId;
                candidate.Title = "LaTeXSnipper Formula";
                return candidate;
            }
            finally
            {
                if (scratchCandidate != null)
                {
                    try
                    {
                        scratchCandidate.LockContents = false;
                        scratchCandidate.LockContentControl = false;
                        scratchCandidate.Delete(true);
                    }
                    catch (Exception cleanupError)
                    {
                        OfficeOperationLog.Failure(
                            "cleanup-inline-omml-scratch",
                            "word",
                            formulaId,
                            cleanupError);
                    }
                }
                if (scratchParagraph != null)
                {
                    try
                    {
                        // Word keeps the paragraph created by InsertParagraphAfter even
                        // after the temporary content control is removed. Delete that
                        // exact tracked paragraph so repeated inline inserts cannot grow
                        // the document tail or leave an empty OMath/scratch container.
                        scratchParagraph.Paragraphs[1].Range.Delete();
                    }
                    catch (Exception cleanupError)
                    {
                        OfficeOperationLog.Failure(
                            "cleanup-inline-omml-scratch-paragraph",
                            "word",
                            formulaId,
                            cleanupError);
                    }
                }
            }
        }

        private static OmmlValidationResult ValidateNativeCandidate(
            Microsoft.Office.Interop.Word.ContentControl candidate,
            string expectedOmml)
        {
            if (candidate != null)
                return OmmlValidator.ValidateHostReadBack(expectedOmml, candidate.Range.WordOpenXML);

            var missing = new OmmlValidationResult();
            missing.Issues.Add(new LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidationIssue
            {
                Code = "OMML_HOST_CANDIDATE_MISSING",
                Message = "Word did not return the tagged native OMML candidate.",
                NaryIndex = -1
            });
            return missing;
        }

        private static InsertResult RollbackInvalidNativeCandidate(
            Microsoft.Office.Interop.Word.Document document,
            Microsoft.Office.Interop.Word.ContentControl candidate,
            string formulaId,
            OmmlValidationResult validation)
        {
            try
            {
                if (candidate != null)
                {
                    candidate.LockContents = false;
                    candidate.LockContentControl = false;
                    candidate.Delete(true);
                }
            }
            catch (Exception cleanupError)
            {
                OfficeOperationLog.Failure(
                    "cleanup-invalid-native-omml-candidate",
                    "word",
                    formulaId,
                    cleanupError);
            }
            FormulaDocumentManifest.Remove(document, formulaId);
            return OmmlValidationFailure(validation, "Word OMML read-back validation failed.");
        }

        private static InsertResult OmmlValidationFailure(
            OmmlValidationResult validation,
            string prefix)
        {
            var first = validation.Issues.Count > 0 ? validation.Issues[0] : null;
            string code = validation.HasIssue("OMML_NARY_OPERAND_DETACHED")
                ? "OMML_NARY_OPERAND_DETACHED"
                : first?.Code ?? "OMML_HOST_VALIDATION_FAILED";
            string detail = first?.Message ?? "No validation detail was returned.";
            return new InsertResult
            {
                Success = false,
                ErrorCode = code,
                Error = prefix + " " + detail
            };
        }

        /// <summary>
        /// Hide ContentControls created by older versions that used the default
        /// bounding-box appearance, which shows a confusing large rectangle.
        /// </summary>
        internal static void HideExistingFormulaContentControls(Microsoft.Office.Interop.Word.Document document)
        {
            if (document == null) return;
            foreach (Microsoft.Office.Interop.Word.ContentControl control in document.ContentControls)
            {
                try
                {
                    string tag = control.Tag as string ?? string.Empty;
                    if (!tag.StartsWith("latexsnipper:formula:", StringComparison.Ordinal)) continue;
                    control.Appearance = Microsoft.Office.Interop.Word.WdContentControlAppearance.wdContentControlHidden;
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("hide-existing-formula-control", "word", null, ex);
                }
            }
        }

        /// <summary>
        /// Adjust the paragraph containing the OLE InlineShape so that line spacing
        /// does not clip the object. Some documents use "Exact" line spacing which
        /// truncates tall OLE objects.
        /// </summary>
        private static void FixWordParagraphForOle(Microsoft.Office.Interop.Word.InlineShape oleShape)
        {
            try
            {
                var paragraph = oleShape.Range.Paragraphs[1];
                var format = paragraph.Format;

                float requiredHeight = Math.Max(oleShape.Height + 2.0f, 12.0f);

                if (format.LineSpacingRule ==
                    Microsoft.Office.Interop.Word.WdLineSpacing.wdLineSpaceExactly)
                {
                    format.LineSpacingRule =
                        Microsoft.Office.Interop.Word.WdLineSpacing.wdLineSpaceAtLeast;
                }

                if (format.LineSpacingRule ==
                    Microsoft.Office.Interop.Word.WdLineSpacing.wdLineSpaceAtLeast &&
                    format.LineSpacing < requiredHeight)
                {
                    format.LineSpacing = requiredHeight;
                }

                // Also fix table row heights if the formula is inside a table cell.
                bool isInsideTable = Convert.ToBoolean(
                    oleShape.Range.get_Information(Microsoft.Office.Interop.Word.WdInformation.wdWithInTable));
                if (isInsideTable)
                {
                    foreach (Microsoft.Office.Interop.Word.Row row in oleShape.Range.Rows)
                    {
                        if (row.HeightRule == Microsoft.Office.Interop.Word.WdRowHeightRule.wdRowHeightExactly)
                        {
                            row.HeightRule = Microsoft.Office.Interop.Word.WdRowHeightRule.wdRowHeightAtLeast;
                        }
                        if (row.Height < requiredHeight)
                        {
                            row.Height = requiredHeight;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("fix-ole-paragraph-spacing", "word", null, ex);
            }
        }

        /// <summary>
        /// Ensure the range is at a block-level insertion point (start of a paragraph).
        /// Moves to the end of the current paragraph and inserts a new paragraph if needed.
        /// </summary>
        private static Microsoft.Office.Interop.Word.Range NormalizeToBlockInsertionPoint(Microsoft.Office.Interop.Word.Range range)
        {
            try
            {
                // If cursor is inside a paragraph (not at start or end), collapse and move to a new paragraph
                if (range.Start != range.Paragraphs[1].Range.Start &&
                    range.Start != range.Paragraphs[1].Range.End - 1)
                {
                    range.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                    range.InsertParagraphAfter();
                    range = range.Duplicate;
                    range.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                }
                return range;
            }
            catch
            {
                return range;
            }
        }

        /// <summary>
        /// Block OLE formulas own an otherwise-empty paragraph so centering or
        /// numbered-equation tab stops never mutate a user paragraph.
        /// </summary>
        private static Microsoft.Office.Interop.Word.Range PrepareBlockOleInsertionRange(
            Microsoft.Office.Interop.Word.Document doc,
            Microsoft.Office.Interop.Word.Range sourceRange)
        {
            var insertionRange = sourceRange.Duplicate;
            if (insertionRange.Start != insertionRange.End)
            {
                insertionRange.Delete();
                insertionRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseStart);
            }

            var paragraphRange = insertionRange.Paragraphs[1].Range.Duplicate;
            bool paragraphIsEmpty = paragraphRange.End <= paragraphRange.Start + 1;
            if (paragraphIsEmpty)
            {
                return doc.Range(paragraphRange.Start, paragraphRange.Start);
            }

            int dedicatedParagraphStart = paragraphRange.End;
            paragraphRange.InsertParagraphAfter();
            return doc.Range(dedicatedParagraphStart, dedicatedParagraphStart);
        }

        private static Microsoft.Office.Interop.Word.Range PrepareNumberedOleInsertionRange(
            Microsoft.Office.Interop.Word.Document doc,
            Microsoft.Office.Interop.Word.Range sourceRange)
        {
            return PrepareBlockOleInsertionRange(doc, sourceRange);
        }

        private static void ConfigureOleContentControl(
            Microsoft.Office.Interop.Word.ContentControl control,
            string formulaId,
            string title,
            string hideOperation)
        {
            control.Tag = $"latexsnipper:formula:{formulaId}";
            control.Title = title;
            control.LockContentControl = false;
            control.LockContents = false;
            try
            {
                control.Appearance =
                    Microsoft.Office.Interop.Word.WdContentControlAppearance.wdContentControlHidden;
            }
            catch (Exception appearanceError)
            {
                OfficeOperationLog.Failure(
                    hideOperation,
                    "word",
                    formulaId,
                    appearanceError);
            }
        }

        private InsertResult InsertOleObject(Microsoft.Office.Interop.Word.Document doc, Microsoft.Office.Interop.Word.Range range, FormulaPayload payload, InsertMode mode = InsertMode.Inline)
        {
            OleActivationResult? activation = null;
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

                FitOleRenderToWordContainer(range, payload);

                if (mode != InsertMode.Inline)
                {
                    range = mode == InsertMode.DisplayNumbered
                        ? PrepareNumberedOleInsertionRange(doc, range)
                        : PrepareBlockOleInsertionRange(doc, range);
                }

                Microsoft.Office.Interop.Word.InlineShape oleShape;
                OleExtentPoints targetExtent;

                using (PendingPayloadLease payloadLease = _oleServerProcessId.HasValue
                    ? OleFormulaPendingPayloadStore.SaveForProcess(
                        payload,
                        _oleServerProcessId.Value)
                    : OleFormulaPendingPayloadStore.Save(payload))
                {
                    oleShape = (Microsoft.Office.Interop.Word.InlineShape)
                        doc.InlineShapes.AddOLEObject(
                            ClassType: "LaTeXSnipper.Formula.1",
                            FileName: Type.Missing,
                            LinkToFile: false,
                            DisplayAsIcon: false,
                            Range: range);

                    activation = OleFormulaActivation.ActivateAndVerify(
                        () => oleShape.OLEFormat?.Object,
                        payload,
                        () => oleShape.Delete(),
                        OleRcwOwnership.OwnedTemporaryRcw);
                    if (!activation.Success)
                    {
                        return new InsertResult { Success = false, ErrorCode = activation.ErrorCode, Error = activation.Message };
                    }

                    // Query the OLE object's natural extent and compute display size with scale.
                    if (activation.AutomationObject == null ||
                        !OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints naturalExtent))
                    {
                        try { oleShape.Delete(); }
                        catch (Exception rollbackError) { OfficeOperationLog.Failure("rollback-invalid-ole-extent", "word", payload.FormulaId, rollbackError); }
                        return new InsertResult { Success = false, ErrorCode = "OLE_EXTENT_UNAVAILABLE", Error = "The OLE object did not expose a valid natural extent." };
                    }

                    targetExtent = OleFormulaInterop.GetInitialDisplayExtent(payload, naturalExtent, OleHostKind.Word);

                    // Constrain to container width to prevent clipping at page/table edges
                    try
                    {
                        var oleRange = oleShape.Range;
                        var paragraphFormat = oleRange.ParagraphFormat;
                        bool isInsideTable = Convert.ToBoolean(
                            oleRange.get_Information(Microsoft.Office.Interop.Word.WdInformation.wdWithInTable));

                        float availableWidth;
                        if (isInsideTable)
                        {
                            var cell = oleShape.Range.Cells[1];
                            availableWidth = cell.Width - cell.LeftPadding - cell.RightPadding
                                - Math.Max(0.0f, paragraphFormat.LeftIndent) - Math.Max(0.0f, paragraphFormat.RightIndent);
                        }
                        else
                        {
                            var section = oleShape.Range.Sections[1];
                            var pageSetup = section.PageSetup;
                            availableWidth = pageSetup.PageWidth - pageSetup.LeftMargin - pageSetup.RightMargin
                                - Math.Max(0.0f, paragraphFormat.LeftIndent) - Math.Max(0.0f, paragraphFormat.RightIndent);
                        }
                        availableWidth = Math.Max(36.0f, availableWidth - 4.0f);
                        targetExtent = OleFormulaInterop.FitDisplayExtent(targetExtent, availableWidth);
                    }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure("fit-extent-container-width", "word", payload.FormulaId, ex);
                    }
                }

                // Wrap the OLE object in a ContentControl with tag so Delete/Replace/Convert can find it.
                // Use an exact single-character range to avoid absorbing paragraph marks or adjacent content.
                Microsoft.Office.Interop.Word.ContentControl? cc = null;
                try
                {
                    int oleStart = oleShape.Range.Start;
                    var exactOleRange = doc.Range(oleStart, oleStart + 1);
                    cc = doc.ContentControls.Add(
                        Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                        exactOleRange);
                    ConfigureOleContentControl(
                        cc,
                        payload.FormulaId,
                        "LaTeXSnipper Formula",
                        "hide-ole-content-control");
                }
                catch (Exception wrapError)
                {
                    OfficeOperationLog.Failure("wrap-ole-content-control", "word", payload.FormulaId, wrapError);
                    try
                    {
                        oleShape.Delete();
                    }
                    catch (Exception rollbackError)
                    {
                        OfficeOperationLog.Failure(
                            "rollback-unowned-ole",
                            "word",
                            payload.FormulaId,
                            rollbackError);
                    }
                    return new InsertResult
                    {
                        Success = false,
                        ErrorCode = "OLE_CONTENT_CONTROL_REQUIRED",
                        Error = "The OLE object could not be wrapped in its required content control."
                    };
                }

                // Move cursor past the OLE object before CompleteInsertion
                try
                {
                    var afterRange = oleShape.Range.Duplicate;
                    afterRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                    _application.Selection.SetRange(afterRange.Start, afterRange.End);
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("collapse-after-ole-insert", "word", payload.FormulaId, ex);
                }

                // CompleteInsertion BEFORE setting Width/Height so SetExtent is no longer ignored
                if (!OleFormulaInterop.CompleteInsertion(activation.AutomationObject))
                {
                    try { oleShape.Delete(); }
                    catch (Exception rollbackError) { OfficeOperationLog.Failure("rollback-incomplete-ole", "word", payload.FormulaId, rollbackError); }
                    return new InsertResult { Success = false, ErrorCode = "OLE_COMPLETE_INSERTION_FAILED", Error = "OLE object did not complete insertion." };
                }
                if (!OleFormulaInterop.TrySetDisplayExtent(activation.AutomationObject, targetExtent) ||
                    !OleFormulaInterop.TryGetExtentPoints(activation.AutomationObject, out OleExtentPoints synchronizedWordExtent) ||
                    !OleFormulaInterop.DisplayExtentMatches(targetExtent, synchronizedWordExtent))
                {
                    try
                    {
                        if (cc != null) cc.Delete(true);
                        else oleShape.Delete();
                    }
                    catch (Exception rollbackError) { OfficeOperationLog.Failure("rollback-ole-geometry", "word", payload.FormulaId, rollbackError); }
                    return new InsertResult
                    {
                        Success = false,
                        ErrorCode = "OLE_GEOMETRY_CONTRACT_FAILED",
                        Error = "OLE display extent did not match the requested Word size."
                    };
                }

                // Word preserves an embedded OLE object's insertion-time size and aspect
                // ratio even when Width/Height or ScaleWidth are assigned through COM.
                // Oversized payloads are therefore fitted before AddOLEObject. At this
                // point Word's settled rectangle is authoritative and is synchronized
                // back to the OLE server.
                oleShape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;

                float wordWidth = oleShape.Width;
                float wordHeight = oleShape.Height;
                var wordSynchronizedExtent = new OleExtentPoints(
                    synchronizedWordExtent.NaturalWidthPt,
                    synchronizedWordExtent.NaturalHeightPt,
                    wordWidth,
                    wordHeight);
                bool wordExtentSynchronized =
                    OleFormulaInterop.TrySetDisplayExtent(
                        activation.AutomationObject,
                        wordSynchronizedExtent);
                bool oleExtentReadBack =
                    OleFormulaInterop.TryGetExtentPoints(
                        activation.AutomationObject,
                        out OleExtentPoints finalOleExtent);
                bool geometryMatches =
                    wordExtentSynchronized &&
                    oleExtentReadBack &&
                    OleFormulaInterop.DisplayExtentMatches(wordSynchronizedExtent, finalOleExtent) &&
                    OleFormulaInterop.HostGeometryMatches(
                        wordSynchronizedExtent,
                        wordWidth,
                        wordHeight);
                if (OleFormulaInterop.TryGetDiagnosticsJson(
                    activation.AutomationObject,
                    out string geometryDiagnostics))
                {
                    OfficeOperationLog.Diagnostic(
                        "ole-insert-geometry",
                        "word",
                        payload.FormulaId,
                        geometryDiagnostics);
                }
                if (!geometryMatches)
                {
                    try
                    {
                        if (cc != null) cc.Delete(true);
                        else oleShape.Delete();
                    }
                    catch (Exception rollbackError) { OfficeOperationLog.Failure("rollback-word-geometry", "word", payload.FormulaId, rollbackError); }
                    return new InsertResult
                    {
                        Success = false,
                        ErrorCode = "OLE_GEOMETRY_CONTRACT_FAILED",
                        Error = $"Word/OLE geometry mismatch. Word={wordWidth:F2}x{wordHeight:F2}pt."
                    };
                }

                // MUST be after final dimensions are set so requiredHeight reflects the enlarged object.
                FixWordParagraphForOle(oleShape);

                if (mode == InsertMode.Display)
                {
                    oleShape.Range.Paragraphs[1].Alignment =
                        Microsoft.Office.Interop.Word.WdParagraphAlignment.wdAlignParagraphCenter;
                }

                // Add auto-numbering for DisplayNumbered mode
                if (mode == InsertMode.DisplayNumbered)
                {
                    try
                    {
                        var paragraph = oleShape.Range.Paragraphs[1];
                        var paragraphFormat = paragraph.Format;
                        float availableWidth;
                        if ((bool)oleShape.Range.get_Information(Microsoft.Office.Interop.Word.WdInformation.wdWithInTable))
                        {
                            var cell = oleShape.Range.Cells[1];
                            availableWidth = cell.Width - cell.LeftPadding - cell.RightPadding;
                        }
                        else
                        {
                            var pageSetup = oleShape.Range.Sections[1].PageSetup;
                            availableWidth = pageSetup.PageWidth - pageSetup.LeftMargin - pageSetup.RightMargin;
                            try
                            {
                                var columns = oleShape.Range.Sections[1].PageSetup.TextColumns;
                                if (columns.Count > 1)
                                    availableWidth = columns[1].Width;
                            }
                            catch (Exception columnError)
                            {
                                System.Diagnostics.Debug.WriteLine($"[WordAdapter] Column width fallback: {columnError.Message}");
                            }
                        }
                        availableWidth = Math.Max(72.0f, availableWidth - paragraphFormat.LeftIndent - paragraphFormat.RightIndent);
                        paragraphFormat.TabStops.Add(availableWidth / 2.0f, Microsoft.Office.Interop.Word.WdTabAlignment.wdAlignTabCenter);
                        paragraphFormat.TabStops.Add(availableWidth, Microsoft.Office.Interop.Word.WdTabAlignment.wdAlignTabRight);

                        // The object starts at the explicit center tab. The number
                        // starts at the explicit right tab for this actual container.
                        var beforeOle = doc.Range(oleShape.Range.Start, oleShape.Range.Start);
                        beforeOle.Text = "\t";
                        var numberedRange = cc?.Range ?? oleShape.Range;
                        numberedRange = numberedRange.Duplicate;
                        numberedRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                        numberedRange.Text = "\t(";
                        numberedRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);

                        // Insert SEQ field for automatic number
                        var field = doc.Fields.Add(
                            numberedRange,
                            Microsoft.Office.Interop.Word.WdFieldType.wdFieldEmpty,
                            " SEQ LaTeXSnipperEquation \\* ARABIC ",
                            true);
                        field.Update();
                        // Result.End is immediately before the field-end marker. Text
                        // inserted there becomes part of the field result and disappears
                        // on the next update/save. Move one character past that marker.
                        int closingPosition = field.Result.End + 1;
                        var closingRange = doc.Range(closingPosition, closingPosition);
                        closingRange.Text = ")";
                        if (!string.Equals(closingRange.Text, ")", StringComparison.Ordinal))
                        {
                            throw new InvalidOperationException(
                                "The numbered formula closing delimiter was not inserted.");
                        }
                        var bookmarkName = "LSNEq_" + System.Text.RegularExpressions.Regex.Replace(payload.FormulaId, "[^A-Za-z0-9_]", "_");
                        if (bookmarkName.Length > 40) bookmarkName = bookmarkName.Substring(0, 40);
                        var bookmarkRange = doc.Range(field.Code.Start, closingRange.End);
                        doc.Bookmarks.Add(bookmarkName, bookmarkRange);

                        // The dedicated paragraph is the ownership boundary. Its
                        // paragraph mark carries the local tab stops, so deleting
                        // the control also removes every layout mutation.
                        var ownedRange = oleShape.Range.Paragraphs[1].Range.Duplicate;
                        if (cc == null)
                        {
                            throw new InvalidOperationException(
                                "The original OLE content control is unavailable.");
                        }
                        var previousControl = cc;
                        var recoveryRange = previousControl.Range.Duplicate;
                        string recoveryTag = previousControl.Tag as string
                            ?? $"latexsnipper:formula:{payload.FormulaId}";
                        string recoveryTitle = previousControl.Title as string
                            ?? "LaTeXSnipper Formula";
                        bool recoveryLockControl = previousControl.LockContentControl;
                        bool recoveryLockContents = previousControl.LockContents;
                        previousControl.Delete(false);
                        cc = null;
                        try
                        {
                            cc = doc.ContentControls.Add(
                                Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                                ownedRange);
                            ConfigureOleContentControl(
                                cc,
                                payload.FormulaId,
                                "LaTeXSnipper Numbered Formula",
                                "hide-numbered-ole-content-control");
                        }
                        catch (Exception rewrapError)
                        {
                            OfficeOperationLog.Failure(
                                "rewrap-numbered-ole-content-control",
                                "word",
                                payload.FormulaId,
                                rewrapError);

                            // Preserve FormulaId ownership while the outer failure
                            // path rolls back the dedicated formula paragraph.
                            try
                            {
                                cc = doc.ContentControls.Add(
                                    Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                                    recoveryRange);
                                ConfigureOleContentControl(
                                    cc,
                                    payload.FormulaId,
                                    recoveryTitle,
                                    "hide-recovered-ole-content-control");
                                cc.Tag = recoveryTag;
                                cc.LockContentControl = recoveryLockControl;
                                cc.LockContents = recoveryLockContents;
                            }
                            catch (Exception recoveryError)
                            {
                                OfficeOperationLog.Failure(
                                    "recover-numbered-ole-content-control",
                                    "word",
                                    payload.FormulaId,
                                    recoveryError);
                            }

                            throw new InvalidOperationException(
                                "The numbered OLE ownership range could not be created.",
                                rewrapError);
                        }
                    }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure(
                            "number-ole-formula",
                            "word",
                            payload.FormulaId,
                            ex);

                        // Numbered insertion is transactional. The paragraph was
                        // created exclusively for this formula, so rolling it back
                        // cannot remove user content and also removes local tabs.
                        try
                        {
                            var rollbackRange = oleShape.Range.Paragraphs[1].Range.Duplicate;
                            if (cc != null)
                            {
                                cc.Delete(false);
                                cc = null;
                            }
                            rollbackRange.Delete();
                        }
                        catch (Exception rollbackError)
                        {
                            OfficeOperationLog.Failure(
                                "rollback-numbered-ole",
                                "word",
                                payload.FormulaId,
                                rollbackError);
                        }

                        return new InsertResult
                        {
                            Success = false,
                            ErrorCode = "OLE_NUMBERING_FAILED",
                            Error = $"Numbered OLE insertion failed: {ex.Message}"
                        };
                    }
                }

                FormulaDocumentManifest.Write(doc, payload);

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)(cc?.Range.Start ?? oleShape.Range.Start),
                    RangeEnd = (uint)(cc?.Range.End ?? oleShape.Range.End)
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WordAdapter] OLE insert error: {ex.Message}");
                OfficeOperationLog.Failure(
                    "insert-ole-object",
                    "word",
                    payload?.FormulaId,
                    ex);
                return new InsertResult
                {
                    Success = false,
                    ErrorCode = $"OLE_INSERT_EXCEPTION_0x{ex.HResult:X8}",
                    Error = $"OLE insert failed: {ex.Message}"
                };
            }
            finally
            {
                activation?.Dispose();
            }
        }

        private static void FitOleRenderToWordContainer(
            Microsoft.Office.Interop.Word.Range range,
            FormulaPayload payload)
        {
            if (payload.Render == null ||
                payload.Render.WidthPt <= 0 ||
                payload.Render.HeightPt <= 0)
            {
                return;
            }

            try
            {
                var paragraphFormat = range.ParagraphFormat;
                float availableWidth;
                float availableHeight;
                if (Convert.ToBoolean(
                    range.get_Information(
                        Microsoft.Office.Interop.Word.WdInformation.wdWithInTable)))
                {
                    var cell = range.Cells[1];
                    availableWidth =
                        cell.Width -
                        cell.LeftPadding -
                        cell.RightPadding -
                        Math.Max(0.0f, paragraphFormat.LeftIndent) -
                        Math.Max(0.0f, paragraphFormat.RightIndent);
                    var pageSetup = range.Sections[1].PageSetup;
                    availableHeight =
                        pageSetup.PageHeight -
                        pageSetup.TopMargin -
                        pageSetup.BottomMargin;
                }
                else
                {
                    var pageSetup = range.Sections[1].PageSetup;
                    availableWidth =
                        pageSetup.PageWidth -
                        pageSetup.LeftMargin -
                        pageSetup.RightMargin -
                        Math.Max(0.0f, paragraphFormat.LeftIndent) -
                        Math.Max(0.0f, paragraphFormat.RightIndent);
                    availableHeight =
                        pageSetup.PageHeight -
                        pageSetup.TopMargin -
                        pageSetup.BottomMargin;
                }

                // Word inserts an OLE inline shape at approximately 4/3 of the
                // server's natural point extent. Fit before activation because
                // post-insertion COM resizing is not reliable for extreme ratios.
                // Keep a small horizontal gutter as well: a shape that merely
                // equals the printable width can have its final script clipped
                // by Word's range/presentation boundary.
                const float wordOleInsertionScale = 1.35f;
                const float wordContainerHorizontalGutterPt = 18.0f;
                // The native SVG presentation adds up to 4pt on each horizontal
                // side and 3pt on each vertical side. Word scales that complete
                // EMF frame, so account for the transparent frame as well as the
                // requested formula content.
                const float nativeMaximumHorizontalPaddingPt = 8.0f;
                const float nativeMaximumVerticalPaddingPt = 6.0f;
                float maximumRenderWidth =
                    Math.Max(
                        36.0f,
                        (availableWidth - wordContainerHorizontalGutterPt) /
                            wordOleInsertionScale -
                            nativeMaximumHorizontalPaddingPt);
                float maximumRenderHeight =
                    Math.Max(
                        72.0f,
                        (availableHeight - 4.0f) /
                            wordOleInsertionScale -
                            nativeMaximumVerticalPaddingPt);
                float scale = Math.Min(
                    1.0f,
                    Math.Min(
                        maximumRenderWidth / payload.Render.WidthPt,
                        maximumRenderHeight / payload.Render.HeightPt));
                if (scale < 1.0f)
                {
                    payload.Render.WidthPt *= scale;
                    payload.Render.HeightPt *= scale;
                }
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure(
                    "fit-ole-render-before-insert",
                    "word",
                    payload.FormulaId,
                    ex);
            }
        }

        private InsertResult InsertImageObject(
            Microsoft.Office.Interop.Word.Document doc,
            Microsoft.Office.Interop.Word.Range range,
            FormulaPayload payload,
            InsertMode mode)
        {
            string tempPath = "";
            try
            {
                if (payload.Render?.Png == null && payload.Render?.Svg == null)
                    return new InsertResult { Success = false, ErrorCode = "NO_RENDER_DATA", Error = "No render data for image insertion" };

                if (mode != InsertMode.Inline)
                {
                    range = mode == InsertMode.DisplayNumbered
                        ? PrepareNumberedOleInsertionRange(doc, range)
                        : PrepareBlockOleInsertionRange(doc, range);
                }

                Microsoft.Office.Interop.Word.InlineShape image;
                string imageId = Guid.NewGuid().ToString("N");

                // PNG-first: Raw MathJax SVG can be accepted by Office but rendered blank.
                if (payload.Render?.Png != null)
                {
                    tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"lsno_{imageId}.png");
                    System.IO.File.WriteAllBytes(tempPath, FormulaImagePayload.DecodePng(payload.Render.Png));
                    image = range.InlineShapes.AddPicture(tempPath);
                }
                else if (payload.Render?.Svg != null)
                {
                    tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"lsno_{imageId}.svg");
                    System.IO.File.WriteAllText(tempPath, payload.Render.Svg);
                    image = range.InlineShapes.AddPicture(tempPath);
                }
                else
                {
                    return new InsertResult { Success = false, ErrorCode = "NO_RENDER_DATA", Error = "No render data for image insertion" };
                }
                image.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                if (payload.Render!.WidthPt > 0)
                {
                    float targetWidth = payload.Render.WidthPt;
                    try
                    {
                        var paragraphFormat = image.Range.ParagraphFormat;
                        var pageSetup = image.Range.Sections[1].PageSetup;
                        float availableWidth =
                            pageSetup.PageWidth -
                            pageSetup.LeftMargin -
                            pageSetup.RightMargin -
                            Math.Max(0.0f, paragraphFormat.LeftIndent) -
                            Math.Max(0.0f, paragraphFormat.RightIndent) -
                            4.0f;
                        targetWidth = Math.Min(
                            targetWidth,
                            Math.Max(36.0f, availableWidth));
                    }
                    catch (Exception fitError)
                    {
                        OfficeOperationLog.Failure(
                            "fit-image-container-width",
                            "word",
                            payload.FormulaId,
                            fitError);
                    }
                    image.Width = targetWidth;
                }

                // Wrap the image in a ContentControl with tag so Delete/Replace/Convert can find it.
                // Without this tag, image formulas cannot be read, replaced, deleted, or converted.
                Microsoft.Office.Interop.Word.ContentControl? cc = null;
                try
                {
                    cc = doc.ContentControls.Add(
                        Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                        image.Range.Duplicate);
                    cc.Tag = $"latexsnipper:formula:{payload.FormulaId}";
                    cc.LockContentControl = false;
                    cc.LockContents = false;
                    try
                    {
                        cc.Appearance =
                            Microsoft.Office.Interop.Word.WdContentControlAppearance.wdContentControlHidden;
                    }
                    catch (Exception appearanceError)
                    {
                        OfficeOperationLog.Failure(
                            "hide-image-content-control",
                            "word",
                            payload.FormulaId,
                            appearanceError);
                    }
                }
                catch
                {
                    // Best-effort; image is still inserted
                    System.Diagnostics.Debug.WriteLine("[WordAdapter] Failed to wrap image with ContentControl");
                }

                if (mode == InsertMode.Display)
                {
                    image.Range.Paragraphs[1].Alignment =
                        Microsoft.Office.Interop.Word.WdParagraphAlignment.wdAlignParagraphCenter;
                }

                if (mode == InsertMode.DisplayNumbered)
                {
                    try
                    {
                        if (cc == null)
                        {
                            throw new InvalidOperationException(
                                "The image content control is unavailable.");
                        }

                        var paragraph = image.Range.Paragraphs[1];
                        var paragraphFormat = paragraph.Format;
                        float availableWidth;
                        if ((bool)image.Range.get_Information(
                            Microsoft.Office.Interop.Word.WdInformation.wdWithInTable))
                        {
                            var cell = image.Range.Cells[1];
                            availableWidth =
                                cell.Width - cell.LeftPadding - cell.RightPadding;
                        }
                        else
                        {
                            var pageSetup = image.Range.Sections[1].PageSetup;
                            availableWidth =
                                pageSetup.PageWidth -
                                pageSetup.LeftMargin -
                                pageSetup.RightMargin;
                            try
                            {
                                var columns =
                                    image.Range.Sections[1].PageSetup.TextColumns;
                                if (columns.Count > 1)
                                {
                                    availableWidth = columns[1].Width;
                                }
                            }
                            catch (Exception columnError)
                            {
                                System.Diagnostics.Debug.WriteLine(
                                    $"[WordAdapter] Image column width fallback: {columnError.Message}");
                            }
                        }

                        availableWidth = Math.Max(
                            72.0f,
                            availableWidth -
                            paragraphFormat.LeftIndent -
                            paragraphFormat.RightIndent);
                        paragraphFormat.TabStops.Add(
                            availableWidth / 2.0f,
                            Microsoft.Office.Interop.Word.WdTabAlignment.wdAlignTabCenter);
                        paragraphFormat.TabStops.Add(
                            availableWidth,
                            Microsoft.Office.Interop.Word.WdTabAlignment.wdAlignTabRight);

                        var beforeImage = doc.Range(
                            image.Range.Start,
                            image.Range.Start);
                        beforeImage.Text = "\t";
                        var numberedRange = cc.Range.Duplicate;
                        numberedRange.Collapse(
                            Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                        numberedRange.Text = "\t(";
                        numberedRange.Collapse(
                            Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);

                        var field = doc.Fields.Add(
                            numberedRange,
                            Microsoft.Office.Interop.Word.WdFieldType.wdFieldEmpty,
                            " SEQ LaTeXSnipperEquation \\* ARABIC ",
                            true);
                        field.Update();
                        int closingPosition = field.Result.End + 1;
                        var closingRange = doc.Range(
                            closingPosition,
                            closingPosition);
                        closingRange.Text = ")";
                        if (!string.Equals(
                            closingRange.Text,
                            ")",
                            StringComparison.Ordinal))
                        {
                            throw new InvalidOperationException(
                                "The numbered image closing delimiter was not inserted.");
                        }

                        var bookmarkName =
                            "LSNEq_" +
                            System.Text.RegularExpressions.Regex.Replace(
                                payload.FormulaId,
                                "[^A-Za-z0-9_]",
                                "_");
                        if (bookmarkName.Length > 40)
                        {
                            bookmarkName = bookmarkName.Substring(0, 40);
                        }
                        var bookmarkRange = doc.Range(
                            field.Code.Start,
                            closingRange.End);
                        doc.Bookmarks.Add(bookmarkName, bookmarkRange);

                        var ownedRange =
                            image.Range.Paragraphs[1].Range.Duplicate;
                        cc.Delete(false);
                        cc = doc.ContentControls.Add(
                            Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                            ownedRange);
                        ConfigureOleContentControl(
                            cc,
                            payload.FormulaId,
                            "LaTeXSnipper Numbered Image",
                            "hide-numbered-image-content-control");
                    }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure(
                            "number-image-formula",
                            "word",
                            payload.FormulaId,
                            ex);
                        try
                        {
                            image.Range.Paragraphs[1].Range.Delete();
                        }
                        catch (Exception rollbackError)
                        {
                            OfficeOperationLog.Failure(
                                "rollback-numbered-image",
                                "word",
                                payload.FormulaId,
                                rollbackError);
                        }
                        return new InsertResult
                        {
                            Success = false,
                            ErrorCode = "IMAGE_NUMBERING_FAILED",
                            Error = $"Numbered image insertion failed: {ex.Message}"
                        };
                    }
                }

                // Write to manifest for reliable read/replace/delete/convert
                FormulaDocumentManifest.Write(doc, payload);

                try
                {
                    var afterRange = cc?.Range.Duplicate ?? image.Range.Duplicate;
                    afterRange.Collapse(
                        Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                    _application.Selection.SetRange(
                        afterRange.Start,
                        afterRange.End);
                }
                catch (Exception selectionError)
                {
                    OfficeOperationLog.Failure(
                        "collapse-after-image-insert",
                        "word",
                        payload.FormulaId,
                        selectionError);
                }

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)(cc?.Range.Start ?? range.Start),
                    RangeEnd = (uint)(cc?.Range.End ?? range.End),
                    StorageMode = "image",
                };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, ErrorCode = "IMAGE_INSERT_FAILED", Error = $"Image insert failed: {ex.Message}" };
            }
            finally
            {
                try { if (!string.IsNullOrEmpty(tempPath) && System.IO.File.Exists(tempPath)) System.IO.File.Delete(tempPath); }
                catch (Exception ex) { OfficeOperationLog.Failure("delete-temp", "word", payload?.FormulaId, ex); }
            }
        }

        /// <summary>
        /// Convert a formula between storage modes (native-omml ↔ ole ↔ image-manifest).
        /// Creates the new storage object, validates it, then deletes the old one.
        /// </summary>
        public InsertResult ConvertFormula(string formulaId, string targetMode)
        {
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null)
                    return new InsertResult { Success = false, Error = "No active document" };

                // 1. Read existing formula from manifest
                var existing = FormulaDocumentManifest.Read(doc, formulaId);
                if (existing == null)
                    return new InsertResult { Success = false, Error = "Formula not found in manifest" };

                // 2. Find existing ContentControl
                Microsoft.Office.Interop.Word.ContentControl? existingCc = null;
                foreach (Microsoft.Office.Interop.Word.ContentControl cc in doc.ContentControls)
                {
                    var tag = cc.Tag as string;
                    if (tag == $"latexsnipper:formula:{formulaId}")
                    {
                        existingCc = cc;
                        break;
                    }
                }

                if (existingCc == null)
                    return new InsertResult { Success = false, Error = "Formula ContentControl not found" };

                // 3. Determine new storage mode
                var newStorageMode = targetMode switch
                {
                    "ole" => "ole",
                    "image" => "image-manifest",
                    "native" => "native-omml",
                    _ => "native-omml"
                };

                // Keep the same FormulaId across conversion — identity must not change
                // Only generate new ID for explicit "copy as new" scenarios
                string convertedFormulaId = formulaId;

                if (newStorageMode == "native-omml")
                {
                    // Convert to native OMML (only works in Word)
                    var omml = existing.Omml;
                    if (string.IsNullOrEmpty(omml))
                    {
                        // Ask Desktop to render LaTeX → OMML
                        // For now, reuse existing ContentControl with new tag
                        existingCc.Tag = $"latexsnipper:formula:{convertedFormulaId}";
                    }
                    else
                    {
                        // Candidate-first conversion. A temporary ID prevents read-back
                        // from accidentally resolving the still-live original control.
                        var range = existingCc.Range.Duplicate;
                        var modeEnum = ParseInsertMode(existing.Display);
                        string candidateId = FormulaIdHelper.NewId();
                        var candidatePayload = new FormulaPayload
                        {
                            FormulaId = candidateId,
                            Latex = existing.Latex,
                            Omml = existing.Omml,
                            Display = existing.Display,
                            StorageMode = "native-omml",
                            Revision = existing.Revision + 1,
                            Render = existing.Render,
                            Presentation = existing.Presentation
                        };
                        _application.Selection.SetRange(range.Start, range.Start);
                        var insertResult = InsertFormula(candidatePayload, modeEnum);
                        if (!insertResult.Success)
                            return insertResult;

                        var candidate = FindFormulaContentControl(doc, candidateId);
                        if (candidate == null)
                            return new InsertResult
                            {
                                Success = false,
                                ErrorCode = "OMML_HOST_CANDIDATE_MISSING",
                                Error = "Converted native OMML candidate could not be read back."
                            };
                        try
                        {
                            existingCc.LockContents = false;
                            existingCc.LockContentControl = false;
                            existingCc.Delete(true);
                        }
                        catch (Exception deleteError)
                        {
                            candidate.LockContents = false;
                            candidate.LockContentControl = false;
                            candidate.Delete(true);
                            FormulaDocumentManifest.Remove(doc, candidateId);
                            return new InsertResult
                            {
                                Success = false,
                                ErrorCode = "ORIGINAL_DELETE_FAILED",
                                Error = deleteError.Message
                            };
                        }
                        candidate.Tag = $"latexsnipper:formula:{convertedFormulaId}";
                        FormulaDocumentManifest.Remove(doc, candidateId);
                    }

                    // Update manifest
                    var newPayload = new FormulaPayload
                    {
                        FormulaId = convertedFormulaId,
                        Latex = existing.Latex,
                        Omml = existing.Omml,
                        Display = existing.Display,
                        StorageMode = "native-omml",
                        Revision = existing.Revision + 1
                    };
                    FormulaDocumentManifest.Remove(doc, formulaId);
                    FormulaDocumentManifest.Write(doc, newPayload);

                    return new InsertResult { Success = true, FormulaId = convertedFormulaId, StorageMode = "native-omml" };
                }

                if (newStorageMode == "ole")
                {
                    // --- Transactional OLE conversion ---
                    // 1. Create a temporary formula payload — copy Render/Presentation from
                    //    existing formula so the OLE object has valid preview data.
                    //    Without this, NormalizeForOle rejects the payload ("OLE formula requires preview data").
                    var olePayload = new FormulaPayload
                    {
                        FormulaId = convertedFormulaId,
                        Latex = existing.Latex ?? "",
                        Omml = existing.Omml ?? "",
                        Display = existing.Display ?? "inline",
                        StorageMode = "ole",
                        Revision = existing.Revision + 1,
                        SchemaVersion = 3,
                        Render = existing.Render,
                        Presentation = existing.Presentation,
                    };

                    // If existing formula has no preview, we cannot create OLE.
                    // The user must re-render the formula first.
                    if (olePayload.Render == null && olePayload.Presentation == null)
                    {
                        return new InsertResult
                        {
                            Success = false,
                            Error = "OLE conversion requires preview data. Please re-render the formula first."
                        };
                    }

                    // 2. Insert OLE object BEFORE deleting old ContentControl
                    var range = existingCc.Range.Duplicate;
                    _application.Selection.SetRange(range.Start, range.Start);
                    var oleResult = InsertOleObject(doc, range, olePayload);
                    if (!oleResult.Success)
                    {
                        // OLE creation failed — old object remains untouched
                        return new InsertResult { Success = false, Error = $"OLE conversion failed: {oleResult.Error}" };
                    }

                    // 3. OLE created and verified — safe to delete old ContentControl
                    existingCc.Delete();

                    // 4. Update manifest (remove old entry, keep same FormulaId)
                    FormulaDocumentManifest.Remove(doc, formulaId);
                    FormulaDocumentManifest.Write(doc, olePayload);

                    return new InsertResult { Success = true, FormulaId = convertedFormulaId, StorageMode = "ole" };
                }

                // image-manifest: keep current OMML content but mark as image-manifest
                existing.StorageMode = "image-manifest";
                existing.Revision++;
                FormulaDocumentManifest.Write(doc, existing);

                return new InsertResult { Success = true, FormulaId = formulaId, StorageMode = "image-manifest" };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
        }

        private static string NormalizeOmml(string omml, InsertMode mode)
        {
            if (string.IsNullOrWhiteSpace(omml)) return "";

            // Preserve semantic math run properties such as bold vectors,
            // upright operators, accents, and script styles. The converter
            // already produces valid OMML; removing every m:rPr is lossy.
            var clean = omml;

            if (clean.Contains("<m:oMathPara"))
            {
                if (mode != InsertMode.Inline)
                    return clean;

                var start = clean.IndexOf("<m:oMath");
                while (start >= 0 && start + "<m:oMath".Length < clean.Length && clean[start + "<m:oMath".Length] == 'P')
                    start = clean.IndexOf("<m:oMath", start + 1);

                var end = clean.LastIndexOf("</m:oMath>");
                if (start >= 0 && end > start)
                    return EnsureStandaloneMathNamespace(
                        clean.Substring(start, end + "</m:oMath>".Length - start));
            }
            else if (!clean.Contains("<m:oMath"))
            {
                clean = "<m:oMath xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">" +
                    clean + "</m:oMath>";
            }

            if (mode != InsertMode.Inline && !clean.Contains("<m:oMathPara"))
                clean = "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">" +
                    clean + "</m:oMathPara>";

            return clean;
        }

        private static string EnsureStandaloneMathNamespace(string omml)
        {
            if (string.IsNullOrWhiteSpace(omml) || omml.Contains("xmlns:m="))
                return omml;

            var root = omml.IndexOf("<m:oMath", StringComparison.Ordinal);
            if (root < 0)
                return omml;

            var insertion = root + "<m:oMath".Length;
            return omml.Insert(
                insertion,
                " xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"");
        }

        private static string BuildFormulaBody(string omml, string formulaId, InsertMode mode)
        {
            var paragraphProperties = mode == InsertMode.Display
                ? "<w:pPr><w:jc w:val=\"center\"/></w:pPr>"
                : "";

            return $@"<w:sdt>
  <w:sdtPr>
    <w:alias w:val=""LaTeXSnipper Formula""/>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      {paragraphProperties}
      {omml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
        }

        private static int GetContainerWidthTwips(Microsoft.Office.Interop.Word.Range range)
        {
            try
            {
                float width;
                if (Convert.ToBoolean(range.get_Information(Microsoft.Office.Interop.Word.WdInformation.wdWithInTable)))
                {
                    var cell = range.Cells[1];
                    width = cell.Width - cell.LeftPadding - cell.RightPadding;
                }
                else
                {
                    var pageSetup = range.Sections[1].PageSetup;
                    width = pageSetup.PageWidth - pageSetup.LeftMargin - pageSetup.RightMargin;
                    var columns = pageSetup.TextColumns;
                    if (columns.Count > 1) width = columns[1].Width;
                }
                width -= Math.Max(0.0f, range.ParagraphFormat.LeftIndent) + Math.Max(0.0f, range.ParagraphFormat.RightIndent);
                return Math.Max(2880, (int)Math.Round(width * 20.0f));
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WordAdapter] Container width fallback: {ex.Message}");
                return 9360;
            }
        }

        private static int BookmarkNumericId(string formulaId)
        {
            uint hash = 2166136261;
            foreach (byte value in System.Text.Encoding.UTF8.GetBytes(formulaId))
            {
                hash ^= value;
                hash *= 16777619;
            }
            return (int)(0x40000000u | (hash & 0x3fffffffu));
        }

        private static string BuildNumberedEquationBody(string omml, string formulaId, int totalWidthTwips)
        {
            var bookmark = "LSNEq_" + System.Text.RegularExpressions.Regex.Replace(formulaId, "[^A-Za-z0-9_]", "_");
            if (bookmark.Length > 40) bookmark = bookmark.Substring(0, 40);
            var sideWidth = Math.Max(720, Math.Min(totalWidthTwips / 4, (int)Math.Round(totalWidthTwips * 0.115)));
            var centerWidth = Math.Max(1440, totalWidthTwips - sideWidth * 2);
            var bookmarkId = BookmarkNumericId(formulaId);
            return $@"<w:sdt>
  <w:sdtPr>
    <w:alias w:val=""LaTeXSnipper Numbered Formula""/>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:tbl>
      <w:tblPr><w:tblW w:w=""5000"" w:type=""pct""/><w:tblLayout w:type=""fixed""/><w:tblBorders><w:top w:val=""nil""/><w:left w:val=""nil""/><w:bottom w:val=""nil""/><w:right w:val=""nil""/><w:insideH w:val=""nil""/><w:insideV w:val=""nil""/></w:tblBorders><w:tblCellMar><w:top w:w=""0"" w:type=""dxa""/><w:left w:w=""0"" w:type=""dxa""/><w:bottom w:w=""0"" w:type=""dxa""/><w:right w:w=""0"" w:type=""dxa""/></w:tblCellMar></w:tblPr>
      <w:tblGrid><w:gridCol w:w=""{sideWidth}""/><w:gridCol w:w=""{centerWidth}""/><w:gridCol w:w=""{sideWidth}""/></w:tblGrid>
      <w:tr><w:trPr><w:cantSplit/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w=""{sideWidth}"" w:type=""dxa""/><w:vAlign w:val=""center""/></w:tcPr><w:p/></w:tc>
        <w:tc><w:tcPr><w:tcW w:w=""{centerWidth}"" w:type=""dxa""/><w:vAlign w:val=""center""/></w:tcPr><w:p><w:pPr><w:jc w:val=""center""/><w:keepLines/><w:keepNext/></w:pPr>{omml}</w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w=""{sideWidth}"" w:type=""dxa""/><w:vAlign w:val=""center""/></w:tcPr><w:p><w:pPr><w:jc w:val=""right""/><w:keepLines/><w:keepNext/></w:pPr><w:bookmarkStart w:id=""{bookmarkId}"" w:name=""{bookmark}""/><w:r><w:t>(</w:t></w:r><w:r><w:fldChar w:fldCharType=""begin""/></w:r><w:r><w:instrText xml:space=""preserve""> SEQ LaTeXSnipperEquation \* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType=""separate""/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType=""end""/></w:r><w:r><w:t>)</w:t></w:r><w:bookmarkEnd w:id=""{bookmarkId}""/></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:sdtContent>
</w:sdt>";
        }

        private static string BuildFlatOpc(string body)
        {
            return $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage"">
  <pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml"">
    <pkg:xmlData>
      <Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships"">
        <Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/>
      </Relationships>
    </pkg:xmlData>
  </pkg:part>
  <pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"">
    <pkg:xmlData>
      <w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main"" xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
        <w:body>{body}</w:body>
      </w:document>
    </pkg:xmlData>
  </pkg:part>
</pkg:package>";
        }

        private static string BuildInlineOmml(string omml, string formulaId)
        {
            return $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    {omml}
  </w:sdtContent>
</w:sdt>";
        }

        private static string BuildDisplayOmml(string omml, string formulaId)
        {
            return $@"<w:sdt xmlns:w=""http://schemas.microsoft.com/office/word/2006/wordml""
                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
  <w:sdtPr>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p>
      {omml}
    </w:p>
  </w:sdtContent>
</w:sdt>";
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
            var doc = _application.ActiveDocument;
            if (doc == null)
                return CommandResultMessage.Failure(cmd.RequestId, "No active document");

            // Build a FormulaPayload from the unified command
            var payload = new FormulaPayload
            {
                FormulaId = cmd.FormulaId ?? FormulaIdHelper.NewId(),
                Latex = cmd.Latex,
                Display = cmd.Display
            };

            var mode = cmd.Display switch
            {
                "numbered" => InsertMode.DisplayNumbered,
                "block" => InsertMode.Display,
                _ => InsertMode.Inline
            };

            var result = InsertFormula(payload, mode);
            return result.Success
                ? CommandResultMessage.Success(cmd.RequestId, result.FormulaId)
                : CommandResultMessage.Failure(cmd.RequestId, result.Error ?? "Insert failed");
        }

        private CommandResultMessage ExecuteGetSelection()
        {
            var payload = ReadSelection();
            if (payload == null)
                return CommandResultMessage.Failure("", "No formula selected");

            // Return OMML — Desktop will convert to LaTeX if needed
            return CommandResultMessage.Success("", payload.Omml);
        }

        private CommandResultMessage ExecuteReplaceSelection(CommandMessage.ReplaceSelection cmd)
        {
            try
            {
                var range = _application.Selection.Range;
                range.Delete();
                _application.Selection.TypeText(cmd.Content);
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
        public string StorageMode { get; set; } = "";
        public int? Revision { get; set; }
        public string? FallbackReason { get; set; }
        public uint? RangeStart { get; set; }
        public uint? RangeEnd { get; set; }
        public string Error { get; set; } = "";
        public string? ErrorCode { get; set; }
    }
}
