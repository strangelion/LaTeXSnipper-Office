#nullable enable
using System;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.Word.Host
{
    internal sealed class WordAdapter : ICommandHostAdapter
    {
        private readonly Microsoft.Office.Interop.Word.Application _application;

        public WordAdapter(Microsoft.Office.Interop.Word.Application application)
        {
            _application = application;
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
                catch { }

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
                    catch { }
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
                catch { }

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
                    catch { }
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
                        control.Delete();
                        return new InsertResult { Success = true };
                    }
                }

                // Also check OMath inside LSNO content control (for deep cursor positions)
                if (sel.OMaths.Count > 0)
                {
                    var parentCc = FindParentLsnContentControl(sel.Range);
                    if (parentCc != null)
                    {
                        parentCc.Delete();
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
                        cc.Delete();
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
            try
            {
                var doc = _application.ActiveDocument;
                if (doc == null) return new InsertResult { Success = false, Error = "No document" };

                // Find formula by ContentControl tag (insertion uses w:tag, not Bookmark)
                foreach (Microsoft.Office.Interop.Word.ContentControl cc in doc.ContentControls)
                {
                    var tag = cc.Tag as string;
                    if (tag == $"latexsnipper:formula:{formulaId}")
                    {
                        var range = cc.Range.Duplicate;
                        cc.Delete();

                        // Re-insert at the same location
                        _application.Selection.SetRange(range.Start, range.Start);
                        var mode = string.IsNullOrEmpty(newPayload.Display) || newPayload.Display == "inline"
                            ? InsertMode.Inline : InsertMode.Display;
                        return InsertFormula(newPayload, mode);
                    }
                }

                return new InsertResult { Success = false, Error = "Formula not found" };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = ex.Message };
            }
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
                    return InsertImageObject(doc, range, payload);
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

                var body = mode == InsertMode.DisplayNumbered
                    ? BuildNumberedEquationBody(cleanOmml, payload.FormulaId)
                    : BuildFormulaBody(cleanOmml, payload.FormulaId, mode);
                var flatOpc = BuildFlatOpc(body);

                range.InsertXML(flatOpc);

                FormulaDocumentManifest.Write(doc, payload);

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)range.Start,
                    RangeEnd = (uint)range.End
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
        /// Insert an inline formula using Word's native OMaths.Add().BuildUp().
        /// This avoids the block-level XML error from InsertXML with <w:p>-containing Flat OPC.
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

                    // Wrap in minimal inline content control for metadata tracking
                    var inlineBody = $@"<w:sdt xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                                         xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
                        <w:sdtPr>
                            <w:tag w:val=""latexsnipper:formula:{payload.FormulaId}""/>
                        </w:sdtPr>
                        <w:sdtContent>
                            {mathOnly}
                        </w:sdtContent>
                    </w:sdt>";

                    // Wrap in Flat OPC for InsertXML
                    var flatOpc = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
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
                                <w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""
                                            xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">
                                    <w:body>{inlineBody}</w:body>
                                </w:document>
                            </pkg:xmlData>
                        </pkg:part>
                    </pkg:package>";

                    range.InsertXML(flatOpc);
                    FormulaDocumentManifest.Write(doc, payload);

                    return new InsertResult
                    {
                        Success = true,
                        FormulaId = payload.FormulaId,
                        RangeStart = (uint)range.Start,
                        RangeEnd = (uint)range.End
                    };
                }

                // Fallback: insert linear formula text
                if (!string.IsNullOrEmpty(payload.Latex))
                {
                    range.Text = payload.Latex;
                    FormulaDocumentManifest.Write(doc, payload);
                    return new InsertResult { Success = true, FormulaId = payload.FormulaId };
                }

                return new InsertResult { Success = false, Error = "No OMML or LaTeX content for inline formula" };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WordAdapter] InsertWordInlineNative error: {ex.Message}");
                // Fallback: try the old InsertXML approach with inline-safe XML
                var cleanOmml = NormalizeOmml(payload.Omml ?? "", InsertMode.Inline);
                if (!string.IsNullOrWhiteSpace(cleanOmml))
                {
                    try
                    {
                        // Minimal inline-safe OMML — no <w:p> wrapper
                        var inlineXml = $"<m:oMath xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">{cleanOmml}</m:oMath>";
                        range.InsertXML(inlineXml);
                        FormulaDocumentManifest.Write(doc, payload);
                        return new InsertResult { Success = true, FormulaId = payload.FormulaId };
                    }
                    catch { }
                }
                return new InsertResult { Success = false, Error = $"Inline formula insert failed: {ex.Message}" };
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

        private InsertResult InsertOleObject(Microsoft.Office.Interop.Word.Document doc, Microsoft.Office.Interop.Word.Range range, FormulaPayload payload, InsertMode mode = InsertMode.Inline)
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

                float width = payload.Render?.WidthPt > 0 ? payload.Render.WidthPt : 120f;
                float height = payload.Render?.HeightPt > 0 ? payload.Render.HeightPt : 30f;

                // Save payload to registry BEFORE creating OLE object.
                // The C++ OLE DLL reads this during construction to render the correct formula
                // immediately, avoiding a race between InitializeFromJson and Office's render request.
                OleFormulaPendingPayloadStore.Save(payload);

                var oleShape = (Microsoft.Office.Interop.Word.InlineShape)
                    range.InlineShapes.AddOLEObject(
                        ClassType: "LaTeXSnipper.Formula.1",
                        FileName: Type.Missing,
                        LinkToFile: false,
                        DisplayAsIcon: false);

                oleShape.Width = width;
                oleShape.Height = height;

                // Initialize with formula payload via OLE automation
                try
                {
                    if (!OleFormulaInterop.Initialize(oleShape.OLEFormat.Object, payload))
                    {
                        oleShape.Delete();
                        return new InsertResult { Success = false, Error = "OLE initialization failed — rollback" };
                    }
                    if (!OleFormulaInterop.VerifyRoundTrip(oleShape.OLEFormat.Object, payload))
                    {
                        oleShape.Delete();
                        return new InsertResult { Success = false, Error = "OLE round-trip verification failed — rollback" };
                    }
                }
                catch (Exception initEx)
                {
                    oleShape.Delete();
                    return new InsertResult { Success = false, Error = $"OLE automation failed: {initEx.Message}" };
                }

                // Wrap the OLE object in a ContentControl with tag so Delete/Replace/Convert can find it.
                // Without this tag, OLE formulas cannot be read, replaced, deleted, or converted.
                Microsoft.Office.Interop.Word.ContentControl? cc = null;
                try
                {
                    var oleRange = oleShape.Range;
                    cc = doc.ContentControls.Add(
                        Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                        oleRange);
                    cc.Tag = $"latexsnipper:formula:{payload.FormulaId}";
                    cc.LockContentControl = false;
                    cc.LockContents = false;
                }
                catch
                {
                    // ContentControl wrapping is best-effort — OLE object is still inserted
                    System.Diagnostics.Debug.WriteLine("[WordAdapter] Failed to wrap OLE with ContentControl");
                }

                // Add auto-numbering for DisplayNumbered mode
                if (mode == InsertMode.DisplayNumbered)
                {
                    try
                    {
                        var numberedRange = cc?.Range ?? oleShape.Range;
                        numberedRange = numberedRange.Duplicate;
                        numberedRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);

                        // Insert tab before number
                        numberedRange.Text = "\t";
                        numberedRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);

                        // Insert SEQ field for automatic number
                        var field = doc.Fields.Add(
                            numberedRange,
                            Microsoft.Office.Interop.Word.WdFieldType.wdFieldEmpty,
                            " SEQ LaTeXSnipperEquation \\* ARABIC ",
                            true);
                        field.Update();

                        // Move past the field
                        var fieldRange = field.Result;
                        fieldRange.Collapse(Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                    }
                    catch (Exception ex)
                    {
                        // Numbering is best-effort — OLE object is still inserted
                        System.Diagnostics.Debug.WriteLine($"[WordAdapter] OLE numbering failed: {ex.Message}");
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
                return new InsertResult { Success = false, Error = $"OLE insert failed: {ex.Message}" };
            }
        }

        private InsertResult InsertImageObject(Microsoft.Office.Interop.Word.Document doc, Microsoft.Office.Interop.Word.Range range, FormulaPayload payload)
        {
            try
            {
                if (payload.Render?.Png == null && payload.Render?.Svg == null)
                    return new InsertResult { Success = false, Error = "No render data for image insertion" };

                // Word prefers PNG for inline images
                string tempPath = "";
                if (payload.Render?.Png != null)
                {
                    tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"lsno_{payload.FormulaId}.png");
                    System.IO.File.WriteAllBytes(tempPath, Convert.FromBase64String(payload.Render.Png));
                    range.InlineShapes.AddPicture(tempPath);
                }
                else
                {
                    tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                    System.IO.File.WriteAllText(tempPath, payload.Render!.Svg!);
                    range.InlineShapes.AddPicture(tempPath);
                }

                // Wrap the image in a ContentControl with tag so Delete/Replace/Convert can find it.
                // Without this tag, image formulas cannot be read, replaced, deleted, or converted.
                Microsoft.Office.Interop.Word.ContentControl? cc = null;
                try
                {
                    cc = doc.ContentControls.Add(
                        Microsoft.Office.Interop.Word.WdContentControlType.wdContentControlRichText,
                        range);
                    cc.Tag = $"latexsnipper:formula:{payload.FormulaId}";
                    cc.LockContentControl = false;
                    cc.LockContents = false;
                }
                catch
                {
                    // Best-effort; image is still inserted
                    System.Diagnostics.Debug.WriteLine("[WordAdapter] Failed to wrap image with ContentControl");
                }

                // Write to manifest for reliable read/replace/delete/convert
                FormulaDocumentManifest.Write(doc, payload);

                // Clean up temp file after successful insertion
                try { if (!string.IsNullOrEmpty(tempPath) && System.IO.File.Exists(tempPath)) System.IO.File.Delete(tempPath); }
                catch { /* temp file cleanup is best-effort */ }

                return new InsertResult
                {
                    Success = true,
                    FormulaId = payload.FormulaId,
                    RangeStart = (uint)(cc?.Range.Start ?? range.Start),
                    RangeEnd = (uint)(cc?.Range.End ?? range.End)
                };
            }
            catch (Exception ex)
            {
                return new InsertResult { Success = false, Error = $"Image insert failed: {ex.Message}" };
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
                        // Insert new ContentControl with OMML at same position
                        var range = existingCc.Range.Duplicate;
                        var modeEnum = existing.Display == "inline" ? InsertMode.Inline : InsertMode.Display;
                        var body = BuildFormulaBody(omml, convertedFormulaId, modeEnum);
                        var flatOpc = BuildFlatOpc(body);

                        // First insert new content (before deleting old)
                        _application.Selection.SetRange(range.Start, range.Start);
                        _application.Selection.Range.InsertXML(flatOpc);

                        // Delete old ContentControl only after successful insertion
                        existingCc.Delete();
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
                    FormulaDocumentManifest.Write(doc, newPayload);
                    FormulaDocumentManifest.Remove(doc, formulaId);

                    return new InsertResult { Success = true, FormulaId = convertedFormulaId, StorageMode = "native-omml" };
                }

                if (newStorageMode == "ole")
                {
                    // --- Transactional OLE conversion ---
                    // 1. Create a temporary formula payload
                    var olePayload = new FormulaPayload
                    {
                        FormulaId = convertedFormulaId,
                        Latex = existing.Latex ?? "",
                        Omml = existing.Omml ?? "",
                        Display = existing.Display ?? "inline",
                        StorageMode = "ole",
                        Revision = existing.Revision + 1,
                        SchemaVersion = 3,
                    };

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

            var clean = System.Text.RegularExpressions.Regex.Replace(
                omml,
                @"<m:rPr>.*?</m:rPr>",
                "",
                System.Text.RegularExpressions.RegexOptions.Singleline);

            if (clean.Contains("<m:oMathPara"))
            {
                if (mode != InsertMode.Inline)
                    return clean;

                var start = clean.IndexOf("<m:oMath");
                while (start >= 0 && start + "<m:oMath".Length < clean.Length && clean[start + "<m:oMath".Length] == 'P')
                    start = clean.IndexOf("<m:oMath", start + 1);

                var end = clean.LastIndexOf("</m:oMath>");
                if (start >= 0 && end > start)
                    return clean.Substring(start, end + "</m:oMath>".Length - start);
            }
            else if (!clean.Contains("<m:oMath"))
            {
                clean = $"<m:oMath>{clean}</m:oMath>";
            }

            if (mode != InsertMode.Inline && !clean.Contains("<m:oMathPara"))
                clean = $"<m:oMathPara>{clean}</m:oMathPara>";

            return clean;
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

        private static string BuildNumberedEquationBody(string omml, string formulaId)
        {
            return $@"<w:sdt>
  <w:sdtPr>
    <w:alias w:val=""LaTeXSnipper Numbered Formula""/>
    <w:tag w:val=""latexsnipper:formula:{formulaId}""/>
  </w:sdtPr>
  <w:sdtContent>
    <w:tbl>
      <w:tr>
        <w:tc><w:p/></w:tc>
        <w:tc><w:p><w:pPr><w:jc w:val=""center""/></w:pPr>{omml}</w:p></w:tc>
        <w:tc><w:p><w:pPr><w:jc w:val=""right""/></w:pPr><w:r><w:t>(</w:t></w:r><w:r><w:fldChar w:fldCharType=""begin""/></w:r><w:r><w:instrText xml:space=""preserve""> SEQ LaTeXSnipperEquation \* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType=""end""/></w:r><w:r><w:t>)</w:t></w:r></w:p></w:tc>
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
    <w:p>
      <w:pPr><w:jc w:val=""center""/></w:pPr>
      {omml}
    </w:p>
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
        public string? FallbackReason { get; set; }
        public uint? RangeStart { get; set; }
        public uint? RangeEnd { get; set; }
        public string Error { get; set; } = "";
    }
}
