#nullable enable
using System;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Metadata;

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

                // Layer 1: OMath collection (cursor inside math zone)
                if (range.OMaths.Count > 0)
                {
                    try
                    {
                        var oMath = range.OMaths[1];
                        var formulaId = Guid.NewGuid().ToString("N").Substring(0, 12);

                        // Get OMML from WordOpenXML
                        var oMathXml = oMath.Range.WordOpenXML;
                        if (!string.IsNullOrEmpty(oMathXml))
                        {
                            var omml = ExtractOmmlFromXml(oMathXml);
                            if (!string.IsNullOrEmpty(omml))
                            {
                                // Return OMML only; Rust Core will convert to LaTeX
                                return new FormulaPayload
                                {
                                    FormulaId = formulaId,
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
                                FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
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
                                    FormulaId = Guid.NewGuid().ToString("N").Substring(0, 12),
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
                System.Diagnostics.Debug.WriteLine(
                    $"[WordAdapter] OMML to insert: [{payload.Omml}]");

                var cleanOmml = NormalizeOmml(payload.Omml, mode);
                if (string.IsNullOrWhiteSpace(cleanOmml))
                    return new InsertResult { Success = false, Error = "OMML conversion returned empty content" };

                var body = mode == InsertMode.DisplayNumbered
                    ? BuildNumberedEquationBody(cleanOmml, payload.FormulaId)
                    : BuildFormulaBody(cleanOmml, payload.FormulaId, mode);
                var flatOpc = BuildFlatOpc(body);

                range.InsertXML(flatOpc);

                FormulaMetadata.Write(doc, payload.FormulaId, payload);

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

        private static string NormalizeOmml(string omml, InsertMode mode)
        {
            if (string.IsNullOrWhiteSpace(omml)) return "";

            var clean = System.Text.RegularExpressions.Regex.Replace(
                omml,
                @"<m:rPr>.*?</m:rPr>",
                "",
                System.Text.RegularExpressions.RegexOptions.Singleline);

            if (clean.Contains("<m:oMathPara>"))
            {
                var start = clean.IndexOf("<m:oMath>");
                var end = clean.LastIndexOf("</m:oMath>");
                if (start >= 0 && end > start)
                    clean = clean.Substring(start, end + "</m:oMath>".Length - start);
            }
            else if (!clean.Contains("<m:oMath"))
            {
                clean = $"<m:oMath>{clean}</m:oMath>";
            }

            if (mode == InsertMode.Inline && clean.Contains("<m:oMathPara>"))
                clean = clean.Replace("<m:oMathPara>", "").Replace("</m:oMathPara>", "");

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
                FormulaId = cmd.FormulaId ?? Guid.NewGuid().ToString("N").Substring(0, 12),
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
        public uint? RangeStart { get; set; }
        public uint? RangeEnd { get; set; }
        public string Error { get; set; } = "";
    }
}
